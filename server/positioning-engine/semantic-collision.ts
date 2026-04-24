import { aiChat } from "../ai-client";

export interface SemanticCollisionResult {
  territoryName: string;
  semanticCollisionScore: number;
  collisionMeaning: string;
  competitorEquivalentClaim: string | null;
  competitorSource: string | null;
  jaccardScore: number | null;
  perCompetitor: Array<{ source: string; claim: string; score: number; rationale: string }>;
  reasoningSteps: string[];
  modelUsed: string;
  generatedAt: string;
}

export interface CompetitorClaim {
  source: string;
  claim: string;
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
  if (score >= 0.85) return "near-identical claim — competitor already owns this exact territory";
  if (score >= 0.75) return "high overlap — buyers will perceive these as the same promise";
  if (score >= 0.65) return "meaningful overlap — competitor has an adjacent claim that will blur differentiation";
  if (score >= 0.50) return "moderate overlap — same category, distinguishable on details";
  if (score >= 0.35) return "low overlap — claims share theme but differ in specific promise";
  return "minimal overlap — claim occupies open semantic space";
}

const SYSTEM = `You are a positioning collision auditor. Given ONE territory claim and a list of competitor claims, you assess SEMANTIC OVERLAP — meaning the buyer would perceive them as the same promise — not surface word overlap.

For each competitor claim, output:
- score (0.0–1.0) where 1.0 = identical promise to the buyer's ear, 0.0 = unrelated
- rationale (one sentence: WHY they overlap or differ in the buyer's mind)

Then identify the SINGLE most colliding competitor.

Strict rules:
- Be calibrated. Reserve >=0.85 for near-identical promises. Reserve <=0.20 for unrelated claims.
- Differ from naive token overlap: claims that share zero words can still mean the same thing (e.g. "AI call coaching" and "conversation intelligence for revenue teams" are >=0.70).
- Output ONLY valid JSON.`;

async function scoreOneTerritory(
  territoryName: string,
  territoryClaim: string,
  competitorClaims: CompetitorClaim[],
  accountId: string,
): Promise<{ perCompetitor: Array<{ source: string; claim: string; score: number; rationale: string }>; topIndex: number } | null> {
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
    max_tokens: 1200,
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
    console.error(`[PositioningSemanticCollision] PARSE_FAILED | ${e.message} | raw="${cleaned.slice(0, 200)}"`);
    return null;
  }
  const per = Array.isArray(parsed.perCompetitor) ? parsed.perCompetitor : [];
  const result: Array<{ source: string; claim: string; score: number; rationale: string }> = [];
  for (const item of per) {
    const idMatch = String(item.id || "").match(/C(\d+)/);
    if (!idMatch) continue;
    const idx = parseInt(idMatch[1], 10) - 1;
    if (idx < 0 || idx >= competitorClaims.length) continue;
    const score = Math.max(0, Math.min(1, Number(item.score) || 0));
    result.push({
      source: competitorClaims[idx].source,
      claim: competitorClaims[idx].claim,
      score: Math.round(score * 1000) / 1000,
      rationale: String(item.rationale || "").slice(0, 280),
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

  if (args.territoryClaims.length === 0 || args.competitorClaims.length === 0) {
    console.log(`[PositioningSemanticCollision] SKIPPED | territories=${args.territoryClaims.length} | competitors=${args.competitorClaims.length}`);
    return [];
  }

  console.log(`[PositioningSemanticCollision] STEP_1 | LLM scoring | territories=${args.territoryClaims.length} | competitors=${args.competitorClaims.length}`);

  const results: SemanticCollisionResult[] = [];

  for (const territory of args.territoryClaims) {
    let scored: Awaited<ReturnType<typeof scoreOneTerritory>> = null;
    try {
      scored = await scoreOneTerritory(territory.name, territory.claimText, args.competitorClaims, args.accountId || "system");
    } catch (e: any) {
      console.error(`[PositioningSemanticCollision] SCORE_FAILED | territory=${territory.name} | ${e.message}`);
    }

    const perCompetitor = scored?.perCompetitor || [];
    const top = perCompetitor[0] || null;
    const semanticScore = top ? top.score : 0;
    const jaccard = top ? Math.round(jaccardSimilarity(territory.claimText, top.claim) * 1000) / 1000 : 0;

    const reasoningSteps: string[] = [
      `Step 1: territory claim "${territory.claimText.slice(0, 100)}"`,
      `Step 2: scored against ${args.competitorClaims.length} competitor claims using LLM semantic comparison (gpt-4.1-mini)`,
      top
        ? `Step 3: highest-collision competitor is "${top.claim.slice(0, 100)}" from ${top.source} with semantic=${semanticScore.toFixed(3)} (Jaccard=${jaccard.toFixed(3)})`
        : `Step 3: no competitor scored — see PARSE_FAILED log`,
      top ? `Step 4: collision rationale — ${top.rationale}` : `Step 4: no rationale available`,
      `Step 5: interpreted as "${interpretSemanticCollision(semanticScore)}"`,
      `Step 6: jaccard=${jaccard.toFixed(3)} vs semantic=${semanticScore.toFixed(3)} — ${jaccard < 0.2 && semanticScore >= 0.65 ? "Jaccard underestimated overlap; LLM caught the semantic equivalence." : jaccard >= 0.5 && semanticScore < 0.5 ? "Jaccard overestimated overlap; LLM shows they actually differ in promise." : "Both methods broadly agree."}`,
    ];

    results.push({
      territoryName: territory.name,
      semanticCollisionScore: Math.round(semanticScore * 1000) / 1000,
      collisionMeaning: interpretSemanticCollision(semanticScore),
      competitorEquivalentClaim: top ? top.claim : null,
      competitorSource: top ? top.source : null,
      jaccardScore: jaccard,
      perCompetitor: perCompetitor.slice(0, 5),
      reasoningSteps,
      modelUsed: "gpt-4.1-mini",
      generatedAt: new Date().toISOString(),
    });

    console.log(`[PositioningSemanticCollision] TERRITORY | ${territory.name} | semantic=${semanticScore.toFixed(3)} | jaccard=${jaccard.toFixed(3)} | nearestCompetitor="${(top?.claim || "").slice(0, 80)}" | meaning="${interpretSemanticCollision(semanticScore)}"`);
  }

  console.log(`[PositioningSemanticCollision] STEP_DONE | ${results.length} territories scored in ${Date.now() - startTs}ms`);
  return results;
}
