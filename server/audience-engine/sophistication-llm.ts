import { aiChat } from "../ai-client";

export interface SegmentSophisticationProfile {
  segmentName: string;
  sophisticationTier: 1 | 2 | 3 | 4 | 5;
  tierLabel: string;
  tierReasoning: string;
  citedEvidence: string[];
  rejectedClaimPatterns: Array<{
    pattern: string;
    whyRejected: string;
    evidence: string;
  }>;
  seenBeforeOffers: Array<{
    offerType: string;
    whatBuyersSay: string;
    saturationLevel: "low" | "moderate" | "high" | "saturated";
  }>;
  reasoningSteps: string[];
  modelUsed: string;
  generatedAt: string;
}

export interface AudienceSophisticationOutput {
  segments: SegmentSophisticationProfile[];
  globalTier: 1 | 2 | 3 | 4 | 5;
  globalTierReasoning: string;
  marketIsBurnt: boolean;
  reasoningSteps: string[];
  generatedAt: string;
}

const TIER_LABELS: Record<number, string> = {
  1: "naive — first exposure to category, will believe anything",
  2: "skeptical of competitors — has heard claims, needs proof",
  3: "burned by category — has been disappointed, demands evidence",
  4: "expert in category — knows mechanisms, judges by specifics",
  5: "saturated — sees through every angle, only identity-level appeals work",
};

const FALLBACK_TIER = 2;

function buildPrompt(args: {
  industry: string;
  coreOffer: string;
  segments: Array<{ name: string; description?: string; painProfile: string[]; desireProfile: string[]; objectionProfile: string[] }>;
  comments: string[];
  objections: string[];
  marketDiagnosis: string | null;
  competitorClaims: string[];
}): string {
  const { industry, coreOffer, segments, comments, objections, marketDiagnosis, competitorClaims } = args;
  const commentBlock = comments.slice(0, 30).map((c, i) => `[C${i + 1}] "${(c || "").slice(0, 220).replace(/\s+/g, " ")}"`).join("\n");
  const objectionBlock = objections.slice(0, 12).map((o, i) => `[O${i + 1}] ${o}`).join("\n");
  const competitorBlock = competitorClaims.slice(0, 10).map((c, i) => `[K${i + 1}] ${c}`).join("\n");
  const segmentBlock = segments.map((s, i) => `SEG_${i + 1}: ${s.name}\n  pains: ${s.painProfile.slice(0, 4).join("; ")}\n  desires: ${s.desireProfile.slice(0, 4).join("; ")}\n  objections: ${s.objectionProfile.slice(0, 4).join("; ")}`).join("\n\n");

  return `You are a Marketing Sophistication Analyst (Eugene Schwartz tradition).
You score how "burned" each audience segment is, based on REAL audience language.

INDUSTRY: ${industry}
CORE OFFER: ${coreOffer}
MARKET DIAGNOSIS: ${marketDiagnosis || "not specified"}

SEGMENTS:
${segmentBlock}

REAL AUDIENCE COMMENTS (cite by [C#] when scoring):
${commentBlock || "(none)"}

OBSERVED OBJECTIONS (cite by [O#]):
${objectionBlock || "(none)"}

COMPETITOR CLAIMS THE MARKET HAS HEARD (cite by [K#]):
${competitorBlock || "(none)"}

═══ SCHWARTZ SOPHISTICATION TIERS ═══
TIER 1 — Naive: first exposure, no skepticism, simple promises work.
TIER 2 — Skeptical of competitors: has heard one round of claims, needs reasons.
TIER 3 — Burned: tried solutions and was disappointed, demands proof.
TIER 4 — Expert: understands mechanisms, judges by specifics, dismisses generic claims.
TIER 5 — Saturated: sees through every angle, only identity-level / status-level appeals land.

═══ HARD RULES ═══
- You MUST cite at least one [C#], [O#], or [K#] for every tier judgement.
- "rejectedClaimPatterns" must be patterns the audience HAS DEMONSTRABLY REJECTED in the comments — not patterns you invented.
- "seenBeforeOffers" must reference the [K#] competitor claims OR specific complaints in [C#].
- If evidence is insufficient for a tier above 2, default to TIER 2 and say so in tierReasoning.
- Do NOT use marketing jargon. Quote the audience.
- Return ONLY valid JSON, no markdown.

Return JSON:
{
  "segments": [
    {
      "segmentName": "<exact name from input>",
      "sophisticationTier": 1|2|3|4|5,
      "tierReasoning": "<2-3 sentences citing [C#]/[O#]/[K#] explaining WHY this tier>",
      "citedEvidence": ["[C2] exact quote", "[O3] objection text"],
      "rejectedClaimPatterns": [
        { "pattern": "<short label>", "whyRejected": "<reason>", "evidence": "[C#] quote" }
      ],
      "seenBeforeOffers": [
        { "offerType": "<short label>", "whatBuyersSay": "<exact quote or paraphrase>", "saturationLevel": "low|moderate|high|saturated" }
      ],
      "reasoningSteps": [
        "Step 1: scanned comments for skepticism markers — found ...",
        "Step 2: checked objections for proof demands — found ...",
        "Step 3: matched against competitor claims — observed ...",
        "Step 4: assigned tier ..."
      ]
    }
  ],
  "globalTier": 1|2|3|4|5,
  "globalTierReasoning": "<weighted across segments>",
  "marketIsBurnt": true|false,
  "reasoningSteps": ["<global synthesis steps>"]
}`;
}

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function clampTier(v: any): 1 | 2 | 3 | 4 | 5 {
  const n = Math.round(Number(v) || FALLBACK_TIER);
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n as 1 | 2 | 3 | 4 | 5;
}

export async function scoreAudienceSophistication(args: {
  industry: string;
  coreOffer: string;
  segments: Array<{ name: string; description?: string; painProfile: string[]; desireProfile: string[]; objectionProfile: string[] }>;
  comments: string[];
  objections: string[];
  marketDiagnosis: string | null;
  competitorClaims: string[];
  accountId: string;
}): Promise<AudienceSophisticationOutput | null> {
  const startTs = Date.now();
  if (args.segments.length === 0) {
    console.log("[AudienceSophistication] SKIPPED — no segments to score");
    return null;
  }
  if (args.comments.length < 3 && args.objections.length < 2) {
    console.log(`[AudienceSophistication] SKIPPED — insufficient evidence (comments=${args.comments.length}, objections=${args.objections.length})`);
    return null;
  }

  console.log(`[AudienceSophistication] STEP_1 | invoking LLM | segments=${args.segments.length} | comments=${args.comments.length} | objections=${args.objections.length} | competitorClaims=${args.competitorClaims.length}`);

  const prompt = buildPrompt(args);
  let response;
  try {
    response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2200,
      endpoint: "audience-engine-sophistication",
      accountId: args.accountId,
    });
  } catch (err: any) {
    console.error(`[AudienceSophistication] LLM_FAILED | ${err.message}`);
    return null;
  }

  const raw = response.choices[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(raw);
  if (!parsed || !Array.isArray(parsed.segments)) {
    console.error(`[AudienceSophistication] PARSE_FAILED | raw=${raw.slice(0, 200)}`);
    return null;
  }

  const generatedAt = new Date().toISOString();
  const segments: SegmentSophisticationProfile[] = parsed.segments.map((s: any) => {
    const tier = clampTier(s.sophisticationTier);
    return {
      segmentName: String(s.segmentName || "unknown"),
      sophisticationTier: tier,
      tierLabel: TIER_LABELS[tier],
      tierReasoning: String(s.tierReasoning || ""),
      citedEvidence: Array.isArray(s.citedEvidence) ? s.citedEvidence.map(String) : [],
      rejectedClaimPatterns: Array.isArray(s.rejectedClaimPatterns)
        ? s.rejectedClaimPatterns.map((p: any) => ({
            pattern: String(p.pattern || ""),
            whyRejected: String(p.whyRejected || ""),
            evidence: String(p.evidence || ""),
          }))
        : [],
      seenBeforeOffers: Array.isArray(s.seenBeforeOffers)
        ? s.seenBeforeOffers.map((o: any) => ({
            offerType: String(o.offerType || ""),
            whatBuyersSay: String(o.whatBuyersSay || ""),
            saturationLevel: ["low", "moderate", "high", "saturated"].includes(o.saturationLevel)
              ? o.saturationLevel
              : "moderate",
          }))
        : [],
      reasoningSteps: Array.isArray(s.reasoningSteps) ? s.reasoningSteps.map(String) : [],
      modelUsed: "gpt-4.1-mini",
      generatedAt,
    };
  });

  const globalTier = clampTier(parsed.globalTier);
  const out: AudienceSophisticationOutput = {
    segments,
    globalTier,
    globalTierReasoning: String(parsed.globalTierReasoning || ""),
    marketIsBurnt: Boolean(parsed.marketIsBurnt) || globalTier >= 4,
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    generatedAt,
  };

  console.log(`[AudienceSophistication] STEP_2 | parsed segments=${segments.length} | globalTier=${globalTier} | burnt=${out.marketIsBurnt} | rejectedPatterns=${segments.reduce((a, s) => a + s.rejectedClaimPatterns.length, 0)} | seenBeforeOffers=${segments.reduce((a, s) => a + s.seenBeforeOffers.length, 0)}`);
  for (const s of segments) {
    console.log(`[AudienceSophistication] SEGMENT | ${s.segmentName} | tier=${s.sophisticationTier} (${s.tierLabel}) | evidenceCited=${s.citedEvidence.length} | reasoning="${s.tierReasoning.slice(0, 120)}"`);
  }
  console.log(`[AudienceSophistication] STEP_3 | DONE in ${Date.now() - startTs}ms`);
  return out;
}
