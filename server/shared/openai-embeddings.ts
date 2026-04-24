import { getGemini } from "../ai-client";

const EMBEDDING_MODEL = "text-embedding-004";
const MAX_TEXT_LENGTH = 8000;

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  model: string;
}

function extractEmbeddingValues(emb: any): number[] {
  if (!emb) return [];
  if (Array.isArray(emb.values)) return emb.values as number[];
  if (Array.isArray(emb)) return emb as number[];
  return [];
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const client = getGemini();
  const truncated = (text || "").slice(0, MAX_TEXT_LENGTH).trim() || "empty";
  const response: any = await client.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: truncated,
  });
  const first = (response?.embeddings && response.embeddings[0]) || response?.embedding;
  return {
    text: truncated,
    embedding: extractEmbeddingValues(first),
    model: EMBEDDING_MODEL,
  };
}

export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  const client = getGemini();
  const cleaned = texts.map(t => (t || "").slice(0, MAX_TEXT_LENGTH).trim() || "empty");
  const results: EmbeddingResult[] = [];
  for (const text of cleaned) {
    const response: any = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });
    const first = (response?.embeddings && response.embeddings[0]) || response?.embedding;
    results.push({
      text,
      embedding: extractEmbeddingValues(first),
      model: EMBEDDING_MODEL,
    });
  }
  return results;
}

export function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function interpretSemanticCollision(score: number): string {
  if (score >= 0.85) return "near-identical claim — competitor already owns this exact territory";
  if (score >= 0.75) return "high overlap — buyers will perceive these as the same promise";
  if (score >= 0.65) return "meaningful overlap — competitor has an adjacent claim that will blur differentiation";
  if (score >= 0.50) return "moderate overlap — same category, distinguishable on details";
  if (score >= 0.35) return "low overlap — claims share theme but differ in specific promise";
  return "minimal overlap — claim occupies open semantic space";
}
