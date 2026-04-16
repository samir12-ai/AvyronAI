import { GoogleGenAI } from "@google/genai";
import type { SignalLineageEntry } from "../../shared/signal-lineage";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_OUTPUT_DIM = 768;
export const SEMANTIC_DIRECT_THRESHOLD = 0.55;
export const SEMANTIC_INFERRED_THRESHOLD = 0.40;

export type GroundingType = "direct" | "inferred" | "none";

export interface SemanticLineageMatch {
  entry: SignalLineageEntry | null;
  score: number;
  type: GroundingType;
  matchedSignalText: string | null;
}

let geminiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const key = process.env.GOOGLE_GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: key });
  }
  return geminiClient;
}

function sanitize(t: string): string {
  const s = (t || "").trim();
  return s.length === 0 ? "empty" : s.slice(0, 2000);
}

async function embedSingle(client: GoogleGenAI, text: string): Promise<number[] | null> {
  try {
    const res: any = await client.models.embedContent({
      model: EMBED_MODEL,
      contents: [sanitize(text)],
      config: { outputDimensionality: EMBED_OUTPUT_DIM } as any,
    });
    const vec =
      res?.embeddings?.[0]?.values ||
      res?.embedding?.values ||
      res?.embeddings?.values ||
      null;
    return Array.isArray(vec) ? vec : null;
  } catch (err: any) {
    console.warn(`[SemanticLineage] EMBED_CALL_FAILED | ${err?.message || err}`);
    return null;
  }
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const client = getClient();
  if (!client) {
    console.warn(`[SemanticLineage] NO_API_KEY | GOOGLE_GEMINI_API_KEY not set`);
    return null;
  }
  const concurrency = 4;
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, async () => {
    while (true) {
      const i = index++;
      if (i >= texts.length) break;
      results[i] = await embedSingle(client, texts[i]);
    }
  });
  await Promise.all(workers);
  if (results.some(r => r === null)) {
    const failed = results.filter(r => r === null).length;
    console.warn(`[SemanticLineage] PARTIAL_EMBED_FAIL | ${failed}/${texts.length} failed`);
    return null;
  }
  return results as number[][];
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function classify(score: number): GroundingType {
  if (score >= SEMANTIC_DIRECT_THRESHOLD) return "direct";
  if (score >= SEMANTIC_INFERRED_THRESHOLD) return "inferred";
  return "none";
}

export async function computeSemanticLineageMatches(
  claimTexts: string[],
  lineage: SignalLineageEntry[],
): Promise<SemanticLineageMatch[]> {
  const noneResult = (): SemanticLineageMatch => ({ entry: null, score: 0, type: "none", matchedSignalText: null });

  if (claimTexts.length === 0) return [];
  if (lineage.length === 0) {
    return claimTexts.map(noneResult);
  }

  const lineageTexts = lineage.map(e => e.signalText || "");
  const t0 = Date.now();
  const [claimVecs, lineageVecs] = await Promise.all([
    embedBatch(claimTexts),
    embedBatch(lineageTexts),
  ]);

  if (!claimVecs || !lineageVecs) {
    console.warn(`[SemanticLineage] FALLBACK_NONE | embedding unavailable — ${claimTexts.length} claims treated as orphaned (no lexical fallback per design)`);
    return claimTexts.map(noneResult);
  }

  const matches: SemanticLineageMatch[] = [];
  let directCount = 0, inferredCount = 0, orphanCount = 0;
  let scoreSum = 0;

  for (let ci = 0; ci < claimTexts.length; ci++) {
    let best = -1;
    let bestIdx = -1;
    for (let li = 0; li < lineageVecs.length; li++) {
      const s = cosine(claimVecs[ci], lineageVecs[li]);
      if (s > best) {
        best = s;
        bestIdx = li;
      }
    }
    const score = Math.max(0, best);
    const type = classify(score);
    const entry = type === "none" ? null : (bestIdx >= 0 ? lineage[bestIdx] : null);
    const matchedSignalText = entry ? entry.signalText : null;
    matches.push({ entry, score, type, matchedSignalText });
    scoreSum += score;
    if (type === "direct") directCount++;
    else if (type === "inferred") inferredCount++;
    else orphanCount++;
  }

  const avg = claimTexts.length > 0 ? scoreSum / claimTexts.length : 0;
  const elapsedMs = Date.now() - t0;
  console.log(`[SemanticLineage] MATCH_SUMMARY | claims=${claimTexts.length} | lineage=${lineage.length} | direct=${directCount} | inferred=${inferredCount} | orphan=${orphanCount} | avgScore=${avg.toFixed(3)} | thresholds=direct>=${SEMANTIC_DIRECT_THRESHOLD}/inferred>=${SEMANTIC_INFERRED_THRESHOLD} | elapsedMs=${elapsedMs}`);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const claimPreview = claimTexts[i].slice(0, 60);
    const matchPreview = m.matchedSignalText ? m.matchedSignalText.slice(0, 60) : "—";
    console.log(`[SemanticLineage] CLAIM_MATCH | #${i} | type=${m.type} | score=${m.score.toFixed(3)} | claim="${claimPreview}" | signal="${matchPreview}"`);
  }

  return matches;
}
