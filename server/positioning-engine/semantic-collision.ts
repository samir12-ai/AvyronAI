import { aiChat } from "../ai-client";

export type ComparisonStatus =
  | "COMPARISON_COMPLETED"
  | "UNVERIFIED_NO_COMPETITOR_CLAIMS"
  | "COMPARISON_FAILED";

export type CompetitorRelationshipClass = "DIRECT" | "ADJACENT" | "REFERENCE";

export interface SemanticCollisionResult {
  territoryName: string;
  comparisonStatus: ComparisonStatus;
  semanticCollisionScore: number;
  collisionMeaning: string;
  competitorEquivalentClaim: string | null;
  competitorSource: string | null;
  competitorId?: string | null;
  jaccardScore: number | null;
  perCompetitor: Array<{
    competitorId?: string;
    source: string;
    claim: string;
    score: number;
    rationale: string;
    relationshipClass?: CompetitorRelationshipClass;
    evidenceSource?: string;
  }>;
  comparedCompetitorCount: number;
  directCompetitorCount: number;
  adjacentCompetitorCount: number;
  referenceCompetitorCount: number;
  reasoningSteps: string[];
  modelUsed: string;
  generatedAt: string;
  comparisonCoverage?: "COMPLETE" | "LIMITED";
}

export interface CompetitorClaim {
  competitorId?: string;
  source: string;
  claim: string;
  relationshipClass?: CompetitorRelationshipClass;
  evidenceSource?: string;
}

function tokenize(s: string): string[] {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(t => t.length > 2);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export function interpretSemanticCollision(score: number): string {
  if (score >= 0.85) return "very high model-estimated semantic overlap — closely overlaps a monitored competitor claim and requires shared-capability framing";
  if (score >= 0.75) return "high model-estimated semantic overlap — buyers may perceive these as a shared category promise";
  if (score >= 0.65) return "meaningful model-estimated overlap — monitored competitor makes an adjacent claim that shares core category positioning";
  if (score >= 0.50) return "moderate model-estimated overlap — shared category baseline, distinguishable on specific mechanism, bundle, or preview details";
  if (score >= 0.35) return "low model-estimated overlap — comparison completed; claims share theme but differ in specific emphasis";
  return "minimal model-estimated overlap — comparison completed across monitored competitor claims";
}

const SYSTEM = `You are a positioning collision auditor. Given ONE territory claim and a list of competitor claims, you assess SEMANTIC OVERLAP — meaning the buyer would perceive them as the same promise — not surface word overlap.

For each competitor claim, output:
- score (0.0–1.0) where 1.0 = identical promise to the buyer's ear, 0.0 = unrelated
- rationale (one sentence: WHY they overlap or differ in the buyer's mind)

Then identify the SINGLE most colliding competitor.

Strict calibration rules:
- >= 0.85 (near-identical): Reserve ONLY for when the competitor claims BOTH the same core category outcome AND the same specific differentiating mechanism, deliverable bundle, or risk-reversal structure (e.g. trial/preview before purchase, companion multimedia deliverables).
- 0.65–0.84 (meaningful/high overlap): The competitor shares the core category outcome AND overlaps on part of the differentiating angle or mechanism, blurring differentiation.
- 0.50–0.64 (moderate category overlap): The competitor operates in the same category and promises the same baseline category outcome (e.g. turning personal stories/memories into personalized songs), but does NOT claim the territory's specific differentiating mechanism, companion deliverable bundle, or trial/preview structure.
- 0.25–0.49 (low overlap): Adjacent or partial thematic overlap, distinct promise.
- <= 0.24 (minimal/unrelated): Different category or unrelated promise.
- Differ from naive token overlap: claims that share zero words can still mean the same thing (e.g. "AI call coaching" and "conversation intelligence for revenue teams" are >=0.70).
- Output ONLY valid JSON.`;

// Recovers complete entries from a token-truncated perCompetitor JSON array.
// Trims the raw text back to the last fully-closed object and re-closes the
// array + wrapper object. Returns null when nothing complete can be recovered
// (the caller then logs PARSE_FAILED as before).
function salvageTruncatedPerCompetitor(cleaned: string): { perCompetitor: unknown[] } | null {
  const arrayStart = cleaned.indexOf("[");
  if (arrayStart === -1) return null;
  const lastComplete = cleaned.lastIndexOf("}");
  if (lastComplete <= arrayStart) return null;
  for (let cut = lastComplete; cut > arrayStart; cut = cleaned.lastIndexOf("}", cut - 1)) {
    const candidate = `{"perCompetitor": ${cleaned.slice(arrayStart, cut + 1)}]}`;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.perCompetitor) && parsed.perCompetitor.length > 0) {
        return parsed;
      }
      return null;
    } catch (candidateErr) {
      // Not yet a complete object boundary — step back to the previous "}".
      // Loop bound: at most one attempt per "}" in the response. Logged by the
      // caller (PARSE_SALVAGED / PARSE_FAILED) — nothing is swallowed here.
      void candidateErr;
    }
  }
  return null;
}

async function scoreOneTerritory(
  territoryName: string,
  territoryClaim: string,
  competitorClaims: CompetitorClaim[],
  accountId: string,
): Promise<{
  perCompetitor: Array<{
    competitorId?: string;
    source: string;
    claim: string;
    score: number;
    rationale: string;
    relationshipClass?: CompetitorRelationshipClass;
    evidenceSource?: string;
  }>;
  topIndex: number;
} | null> {
  const numbered = competitorClaims.map((c, i) => `[C${i + 1}] (${c.source}) ${c.claim}`).join("\n");
  const userPrompt = `Territory claim:
"${territoryClaim}"

Competitor claims:
${numbered}

Return JSON exactly:
{
  "perCompetitor": [
    { "id": "C1", "score": 0.0, "rationale": "..." }
  ],
  "topCompetitorId": "C1"
}`;

  const response = await aiChat({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    // Output size scales with the competitor list (one scored object with a
    // one-sentence rationale per claim). The old fixed 1200 truncated the JSON
    // mid-string at ~15+ claims → PARSE_FAILED → zero competitors scored.
    max_tokens: Math.min(4000, 300 + 90 * competitorClaims.length),
    temperature: 0.2,
    accountId,
    endpoint: "positioning-semantic-collision",
  });
  const raw = response.choices[0]?.message?.content?.trim() || "";
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    // Truncation salvage: if the model still ran out of tokens mid-array,
    // recover every COMPLETE perCompetitor entry rather than discarding the
    // whole scoring pass. topCompetitorId is not needed — the caller derives
    // the top collision from the recovered scores.
    parsed = salvageTruncatedPerCompetitor(cleaned);
    if (parsed) {
      console.warn(`[PositioningSemanticCollision] PARSE_SALVAGED | ${e.message} | recovered=${parsed.perCompetitor.length}/${competitorClaims.length} entries from truncated response`);
    } else {
      console.error(`[PositioningSemanticCollision] PARSE_FAILED | ${e.message} | raw="${cleaned.slice(0, 200)}"`);
      return null;
    }
  }
  const per = Array.isArray(parsed.perCompetitor) ? parsed.perCompetitor : [];
  const result: Array<{
    competitorId?: string;
    source: string;
    claim: string;
    score: number;
    rationale: string;
    relationshipClass?: CompetitorRelationshipClass;
    evidenceSource?: string;
  }> = [];
  for (const item of per) {
    const idMatch = String(item.id || "").match(/C(\d+)/);
    if (!idMatch) continue;
    const idx = parseInt(idMatch[1], 10) - 1;
    if (idx < 0 || idx >= competitorClaims.length) continue;
    const score = Math.max(0, Math.min(1, Number(item.score) || 0));
    result.push({
      competitorId: competitorClaims[idx].competitorId,
      source: competitorClaims[idx].source,
      claim: competitorClaims[idx].claim,
      score: Math.round(score * 1000) / 1000,
      rationale: String(item.rationale || "").slice(0, 280),
      relationshipClass: competitorClaims[idx].relationshipClass,
      evidenceSource: competitorClaims[idx].evidenceSource,
    });
  }
  result.sort((a, b) => b.score - a.score);
  const topIndex = result.length > 0 ? competitorClaims.findIndex(c => c.source === result[0].source && c.claim === result[0].claim) : -1;
  return { perCompetitor: result, topIndex };
}

export async function computeSemanticCollisions(args: {
  territoryClaims: Array<{ name: string; claimText: string }>;
  competitorClaims: CompetitorClaim[];
  accountId?: string;
}): Promise<SemanticCollisionResult[]> {
  const startTs = Date.now();

  if (args.territoryClaims.length === 0) {
    console.log(`[PositioningSemanticCollision] SKIPPED | territories=0 | competitors=${args.competitorClaims.length}`);
    return [];
  }

  if (args.competitorClaims.length === 0) {
    console.log(`[PositioningSemanticCollision] LIMITED_COVERAGE | territories=${args.territoryClaims.length} | competitors=0`);
    return args.territoryClaims.map(t => ({
      territoryName: t.name,
      comparisonStatus: "UNVERIFIED_NO_COMPETITOR_CLAIMS",
      semanticCollisionScore: 0,
      collisionMeaning: "comparison unverified — no substantive competitor claims available for benchmarking",
      competitorEquivalentClaim: null,
      competitorSource: null,
      competitorId: null,
      jaccardScore: null,
      perCompetitor: [],
      comparedCompetitorCount: 0,
      directCompetitorCount: 0,
      adjacentCompetitorCount: 0,
      referenceCompetitorCount: 0,
      reasoningSteps: ["No substantive competitor positioning claims available; open whitespace cannot be empirically confirmed."],
      modelUsed: "none",
      generatedAt: new Date().toISOString(),
      comparisonCoverage: "LIMITED",
    }));
  }

  const uniqueCompetitors = new Map<string, CompetitorRelationshipClass>();
  for (const c of args.competitorClaims) {
    const key = (c.competitorId || c.source || "unknown").toLowerCase().trim();
    const cls = c.relationshipClass || "DIRECT";
    const existing = uniqueCompetitors.get(key);
    if (!existing || (existing !== "DIRECT" && cls === "DIRECT") || (existing === "REFERENCE" && cls === "ADJACENT")) {
      uniqueCompetitors.set(key, cls);
    }
  }
  let directCompetitorCount = 0;
  let adjacentCompetitorCount = 0;
  let referenceCompetitorCount = 0;
  for (const cls of uniqueCompetitors.values()) {
    if (cls === "DIRECT") directCompetitorCount++;
    else if (cls === "ADJACENT") adjacentCompetitorCount++;
    else referenceCompetitorCount++;
  }
  const comparedCompetitorCount = uniqueCompetitors.size;

  console.log(`[PositioningSemanticCollision] STEP_1 | LLM scoring | territories=${args.territoryClaims.length} | competitorClaims=${args.competitorClaims.length} | uniqueCompetitors=${comparedCompetitorCount} (direct=${directCompetitorCount}, adjacent=${adjacentCompetitorCount}, reference=${referenceCompetitorCount})`);

  // Each territory scoring call is independent: no shared mutable state between calls,
  // and the competitor list is read-only. Promise.all preserves insertion order so the
  // returned array matches args.territoryClaims order exactly.
  const results: SemanticCollisionResult[] = await Promise.all(
    args.territoryClaims.map(async (territory): Promise<SemanticCollisionResult> => {
      let scored: Awaited<ReturnType<typeof scoreOneTerritory>> = null;
      try {
        scored = await scoreOneTerritory(territory.name, territory.claimText, args.competitorClaims, args.accountId || "system");
      } catch (e: any) {
        console.error(`[PositioningSemanticCollision] SCORE_FAILED | territory=${territory.name} | ${e.message}`);
      }

      const perCompetitor = scored?.perCompetitor || [];
      const top = perCompetitor[0] || null;
      const hasValidComparison = perCompetitor.length > 0;
      const comparisonStatus: ComparisonStatus = hasValidComparison ? "COMPARISON_COMPLETED" : "COMPARISON_FAILED";
      const semanticScore = top ? top.score : 0;
      const jaccard = top ? Math.round(jaccardSimilarity(territory.claimText, top.claim) * 1000) / 1000 : null;
      const meaning = hasValidComparison
        ? interpretSemanticCollision(semanticScore)
        : "comparison failed — LLM semantic scoring returned no valid competitor comparisons";

      const reasoningSteps: string[] = [
        `Step 1: territory claim "${territory.claimText.slice(0, 100)}"`,
        `Step 2: scored against ${args.competitorClaims.length} competitor claims across ${comparedCompetitorCount} competitors (direct=${directCompetitorCount}, adjacent=${adjacentCompetitorCount}, reference=${referenceCompetitorCount}) using LLM semantic comparison (gpt-4.1-mini)`,
        top
          ? `Step 3: highest-collision competitor is "${top.claim.slice(0, 100)}" from ${top.source}${top.competitorId ? ` [${top.competitorId}]` : ""} with semantic=${semanticScore.toFixed(3)} (Jaccard=${(jaccard ?? 0).toFixed(3)})`
          : `Step 3: no competitor scored — see PARSE_FAILED log`,
        top ? `Step 4: collision rationale — ${top.rationale}` : `Step 4: no rationale available`,
        `Step 5: interpreted as "${meaning}"`,
        hasValidComparison
          ? `Step 6: jaccard=${(jaccard ?? 0).toFixed(3)} vs semantic=${semanticScore.toFixed(3)} — ${(jaccard ?? 0) < 0.2 && semanticScore >= 0.65 ? "Jaccard underestimated overlap; LLM caught the semantic equivalence." : (jaccard ?? 0) >= 0.5 && semanticScore < 0.5 ? "Jaccard overestimated overlap; LLM shows they actually differ in promise." : "Both methods broadly agree."}`
          : `Step 6: comparison unavailable due to scoring failure.`,
      ];

      console.log(`[PositioningSemanticCollision] TERRITORY | ${territory.name} | status=${comparisonStatus} | semantic=${semanticScore.toFixed(3)} | jaccard=${(jaccard ?? 0).toFixed(3)} | nearestCompetitor="${(top?.claim || "").slice(0, 80)}" | meaning="${meaning}"`);

      return {
        territoryName: territory.name,
        comparisonStatus,
        semanticCollisionScore: Math.round(semanticScore * 1000) / 1000,
        collisionMeaning: meaning,
        competitorEquivalentClaim: top ? top.claim : null,
        competitorSource: top ? top.source : null,
        competitorId: top?.competitorId || null,
        jaccardScore: jaccard,
        perCompetitor: perCompetitor.slice(0, 10),
        comparedCompetitorCount: hasValidComparison ? comparedCompetitorCount : 0,
        directCompetitorCount: hasValidComparison ? directCompetitorCount : 0,
        adjacentCompetitorCount: hasValidComparison ? adjacentCompetitorCount : 0,
        referenceCompetitorCount: hasValidComparison ? referenceCompetitorCount : 0,
        reasoningSteps,
        modelUsed: hasValidComparison ? "gpt-4.1-mini" : "none",
        generatedAt: new Date().toISOString(),
        comparisonCoverage: hasValidComparison ? "COMPLETE" : "LIMITED",
      };
    })
  );

  console.log(`[PositioningSemanticCollision] STEP_DONE | ${results.length} territories scored in ${Date.now() - startTs}ms`);
  return results;
}
