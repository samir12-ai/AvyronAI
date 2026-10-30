import { z } from "zod";
import { aiChat } from "../ai-client";
import { generateWithRepair } from "../shared/llm-reliability/reliability-runner";
import { safeJsonParse } from "../shared/strategic-doctrine";
import type { CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";

export const marketVoiceSufficiencySchema = z.object({
  verdict: z.enum(["SUFFICIENT", "INSUFFICIENT"]),
  reason: z.string().min(5),
  categoryRelevance: z.enum(["HIGH", "MEDIUM", "LOW", "IRRELEVANT"]),
  buyerAuthenticity: z.enum(["VERIFIED_BUYER", "MIXED", "NON_BUYER"]),
  sourceConcentrationRisk: z.enum(["HIGH_SINGLE_SOURCE", "MODERATE", "DIVERSE"]).default("DIVERSE"),
  categoryBreadth: z.enum(["BROAD_CATEGORY_TRUTHS", "MIXED", "SINGLE_BRAND_INCIDENT"]).default("BROAD_CATEGORY_TRUTHS"),
  substantiveThemesFound: z.array(z.string()).default([]),
});

export type MarketVoiceSufficiencyResult = z.infer<typeof marketVoiceSufficiencySchema> & {
  isSufficient: boolean;
};

export interface SufficiencyJudgeContext {
  heroProduct: string;
  businessName: string;
  category: string;
  market: string;
}

/**
 * Extracts underlying source entity and hosting platform from evidence URL / properties.
 * Separates generic hosting platform (e.g. Trustpilot, Reddit) from merchant or community entity.
 */
export function extractEvidenceSourceEntity(u: CustomerEvidenceUnit): {
  hostingPlatform: string;
  sourceEntity: string;
} {
  let hostingPlatform = u.platform || "unknown";
  let sourceEntity = u.competitorName || u.platform || "unknown";

  const sourceUrl = u.verificationProvenance?.sourceUrl;
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      const host = parsed.hostname.replace(/^www\./, "");

      if (host.includes("trustpilot.com")) {
        hostingPlatform = "trustpilot";
        const match = parsed.pathname.match(/\/review\/([^/?#]+)/i);
        if (match && match[1]) {
          sourceEntity = match[1].toLowerCase();
        } else {
          sourceEntity = host;
        }
      } else if (host.includes("reddit.com")) {
        hostingPlatform = "reddit";
        const match = parsed.pathname.match(/\/r\/([^/?#]+)/i);
        if (match && match[1]) {
          sourceEntity = `r/${match[1].toLowerCase()}`;
        } else {
          sourceEntity = "reddit_community";
        }
      } else {
        hostingPlatform = host;
        sourceEntity = host;
      }
    } catch {
      // fallback to unit properties
    }
  }

  return { hostingPlatform, sourceEntity };
}

/**
 * Deduplicates CustomerEvidenceUnit[] across domain mirrors (e.g. trustpilot.com vs au.trustpilot.com)
 * based on normalized verbatim text, preserving highest-priority scope and complete contributor lineage.
 */
export function deduplicatePrimaryUnits(units: CustomerEvidenceUnit[]): CustomerEvidenceUnit[] {
  const seen = new Map<string, CustomerEvidenceUnit>();

  const scopePriority = (s?: string) => {
    if (s === "CATEGORY_RECURRING") return 3;
    if (s === "MARKET_TRANSFERABLE") return 2;
    if (s === "SINGLE_BRAND_SPECIFIC" || s === "INCIDENT_SPECIFIC") return 1;
    return 0;
  };

  for (const u of units) {
    if (!u.text || u.text.trim().length === 0) continue;
    const normText = u.text.trim().toLowerCase().replace(/\s+/g, " ");

    if (seen.has(normText)) {
      const existing = seen.get(normText)!;
      if (scopePriority(u.semanticScope) > scopePriority(existing.semanticScope)) {
        existing.semanticScope = u.semanticScope;
        existing.transferability = u.transferability;
        existing.eligibilityVerdict = u.eligibilityVerdict;
      }
    } else {
      seen.set(normText, { ...u });
    }
  }

  return Array.from(seen.values());
}

/**
 * Deterministic Structural Representative Sampler.
 * Balances representation across semantic scopes (Category Recurring, Market Transferable, Single Brand)
 * and distinct source entities/communities, preventing insertion order or single-merchant dominance.
 */
export function buildRepresentativeEvidenceCorpus(
  units: CustomerEvidenceUnit[],
  targetCount: number = 50
): CustomerEvidenceUnit[] {
  const deduped = deduplicatePrimaryUnits(units);
  if (deduped.length <= targetCount) {
    return deduped;
  }

  const categoryRecurring: CustomerEvidenceUnit[] = [];
  const marketTransferable: CustomerEvidenceUnit[] = [];
  const singleBrandOrIncident: CustomerEvidenceUnit[] = [];
  const otherScope: CustomerEvidenceUnit[] = [];

  for (const u of deduped) {
    const scope = u.semanticScope || "INSUFFICIENT_SCOPE";
    if (scope === "CATEGORY_RECURRING") {
      categoryRecurring.push(u);
    } else if (scope === "MARKET_TRANSFERABLE") {
      marketTransferable.push(u);
    } else if (scope === "SINGLE_BRAND_SPECIFIC" || scope === "INCIDENT_SPECIFIC") {
      singleBrandOrIncident.push(u);
    } else {
      otherScope.push(u);
    }
  }

  const roundRobinBySource = (pool: CustomerEvidenceUnit[], maxItems: number): CustomerEvidenceUnit[] => {
    if (pool.length <= maxItems) return pool;

    const bySource = new Map<string, CustomerEvidenceUnit[]>();
    for (const item of pool) {
      const { sourceEntity } = extractEvidenceSourceEntity(item);
      if (!bySource.has(sourceEntity)) {
        bySource.set(sourceEntity, []);
      }
      bySource.get(sourceEntity)!.push(item);
    }

    for (const list of bySource.values()) {
      list.sort((a, b) => b.text.length - a.text.length || a.evidenceId.localeCompare(b.evidenceId));
    }

    const selected: CustomerEvidenceUnit[] = [];
    const sourceKeys = Array.from(bySource.keys()).sort();
    let index = 0;
    let hasMore = true;

    while (selected.length < maxItems && hasMore) {
      hasMore = false;
      for (const src of sourceKeys) {
        const list = bySource.get(src)!;
        if (index < list.length) {
          selected.push(list[index]);
          hasMore = true;
          if (selected.length >= maxItems) break;
        }
      }
      index++;
    }

    return selected;
  };

  const catCap = Math.round(targetCount * 0.45); // e.g. 23
  const transCap = Math.round(targetCount * 0.35); // e.g. 17
  const singleCap = targetCount - catCap - transCap; // e.g. 10

  const sampledCat = roundRobinBySource(categoryRecurring, catCap);
  const sampledTrans = roundRobinBySource(marketTransferable, transCap);
  const sampledSingle = roundRobinBySource(singleBrandOrIncident, singleCap);

  const result: CustomerEvidenceUnit[] = [...sampledCat, ...sampledTrans, ...sampledSingle];

  if (result.length < targetCount) {
    const selectedIds = new Set(result.map(r => r.evidenceId));
    const remaining = [
      ...categoryRecurring.filter(u => !selectedIds.has(u.evidenceId)),
      ...marketTransferable.filter(u => !selectedIds.has(u.evidenceId)),
      ...singleBrandOrIncident.filter(u => !selectedIds.has(u.evidenceId)),
      ...otherScope.filter(u => !selectedIds.has(u.evidenceId)),
    ];
    const additional = roundRobinBySource(remaining, targetCount - result.length);
    result.push(...additional);
  }

  return result;
}

/**
 * Hostile Semantic Sufficiency Judge for Primary Market Voice.
 *
 * Evaluates whether the verified Primary Market Voice corpus is:
 * 1. Relevant to the specific offering & category
 * 2. Customer/buyer authored (authentic user voices, not marketing/vendor noise)
 * 3. Semantically substantive (actionable complaints, pains, desires, trade-offs)
 * 4. Capable of supporting coherent customer truths
 * 5. Free from extreme single-source concentration / single-store incident dominance
 *
 * Hardened with bounded retry/repair. Fail-closed on failure.
 */
export async function judgePrimaryMarketVoiceSufficiencyWithLLM(
  primaryUnits: CustomerEvidenceUnit[],
  context: SufficiencyJudgeContext,
  accountId: string
): Promise<MarketVoiceSufficiencyResult> {
  // 1. Immediate deterministic fail-closed on empty corpus
  if (!primaryUnits || primaryUnits.length === 0) {
    return {
      isSufficient: false,
      verdict: "INSUFFICIENT",
      reason: "Zero primary evidence units available in the verified corpus.",
      categoryRelevance: "IRRELEVANT",
      buyerAuthenticity: "NON_BUYER",
      sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
      categoryBreadth: "SINGLE_BRAND_INCIDENT",
      substantiveThemesFound: [],
    };
  }

  // 2. Deduplicate mirrored evidence and compute objective telemetry across the deduplicated corpus
  const dedupedUnits = deduplicatePrimaryUnits(primaryUnits);
  const entityCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const scopeCounts: Record<string, number> = {
    CATEGORY_RECURRING: 0,
    MARKET_TRANSFERABLE: 0,
    SINGLE_BRAND_SPECIFIC: 0,
    INCIDENT_SPECIFIC: 0,
    INSUFFICIENT_SCOPE: 0,
  };

  for (const u of dedupedUnits) {
    const { sourceEntity, hostingPlatform } = extractEvidenceSourceEntity(u);
    entityCounts[sourceEntity] = (entityCounts[sourceEntity] || 0) + 1;
    platformCounts[hostingPlatform] = (platformCounts[hostingPlatform] || 0) + 1;

    const scope = (u.semanticScope as keyof typeof scopeCounts) || "INSUFFICIENT_SCOPE";
    scopeCounts[scope] = (scopeCounts[scope] || 0) + 1;
  }

  const uniqueEntities = Object.keys(entityCounts);
  const maxEntityCount = Math.max(...Object.values(entityCounts), 0);
  const dominantEntityShare = dedupedUnits.length > 0 ? Number((maxEntityCount / dedupedUnits.length).toFixed(2)) : 0;
  const dominantEntityName = uniqueEntities.find(k => entityCounts[k] === maxEntityCount) || "none";

  const corpusTelemetry = {
    totalRawPrimaryUnits: primaryUnits.length,
    totalDeduplicatedUnits: dedupedUnits.length,
    uniqueSourceEntitiesCount: uniqueEntities.length,
    sourceEntityDistribution: entityCounts,
    dominantSourceEntity: `${dominantEntityName} (${(dominantEntityShare * 100).toFixed(1)}%)`,
    dominantSourceEntityShare: dominantEntityShare,
    semanticScopeDistribution: scopeCounts,
    platformsRepresented: Object.keys(platformCounts),
  };

  // 3. Format structural representative sample preserving all canonical semantic authority
  const sampledUnits = buildRepresentativeEvidenceCorpus(dedupedUnits, 50);

  const formattedQuotes = sampledUnits.map((u, idx) => {
    const origin = u.origin || "MARKET_VOICE";
    const plat = u.platform || "unknown";
    const { sourceEntity } = extractEvidenceSourceEntity(u);
    const scope = u.semanticScope || "UNCLASSIFIED";
    const transfer = u.transferability || "UNSPECIFIED";
    const eligibility = u.eligibilityVerdict || "ELIGIBLE";
    const sourceUrl = u.verificationProvenance?.sourceUrl || u.rawEvidenceReference?.table || "independent";

    return `[Evidence ${idx + 1}] (Origin: ${origin} | Scope: ${scope} | Transferability: ${transfer} | Eligibility: ${eligibility} | Source Entity: ${sourceEntity} | Platform: ${plat} | Source: ${sourceUrl})\n"${u.text}"`;
  }).join("\n\n");

  const systemPrompt = `You are the Hostile Primary Market Voice Sufficiency Judge for Avyron AI.
Your mission is to evaluate whether the provided primary customer evidence corpus is semantically sufficient to originate canonical customer themes and pains for the given business and offering.

OFFERING CONTEXT:
- Hero Offering: ${context.heroProduct}
- Business Name: ${context.businessName}
- Category: ${context.category}
- Target Market: ${context.market}

CORPUS TELEMETRY & FACTS:
${JSON.stringify(corpusTelemetry, null, 2)}

EVALUATION CRITERIA (APPLIES ACROSS ALL INDUSTRIES):
1. CATEGORY & OFFERING RELEVANCE:
   The evidence must genuinely discuss the relevant product category, use cases, problems, desires, or buying trade-offs for '${context.heroProduct}' in '${context.category}'.
2. BUYER AUTHENTICITY:
   The quotes must represent genuine end-consumer, buyer, or community user perspectives rather than marketing copy, vendor self-promotion, or bot spam.
3. SEMANTIC SUBSTANTIVENESS & PRODUCT TRUTHS:
   - The quotes must contain substantive user experiences, pain points, desires, fabric/fit/style trade-offs, heat tolerance, or usability requirements.
   - Distinguish between single-store merchant fulfillment/shipping/refund disputes (which provide single-brand incident context) versus authentic consumer feedback on category product truths.
4. SOURCE PORTFOLIO DIVERSITY & SCOPE INTEGRITY:
   - Each evidence item includes its upstream semantic scope: CATEGORY_RECURRING (broad category truths), MARKET_TRANSFERABLE (cross-brand customer dynamics), or SINGLE_BRAND_SPECIFIC (individual merchant incidents).
   - If the corpus contains substantive CATEGORY_RECURRING and MARKET_TRANSFERABLE category product truths across independent communities and sources, classify as 'SUFFICIENT'.
   - If the corpus lacks category/transferable insights and is overwhelmingly dominated by a single company's untransferable operational disputes with zero generalizable product truths, classify as 'INSUFFICIENT' with 'SINGLE_BRAND_INCIDENT' and 'HIGH_SINGLE_SOURCE'.
5. THEME GENESIS CAPABILITY:
   The corpus must be coherent enough to support extracting substantive, transferable customer truths for the campaign.

VERDICT RULES:
- Output "SUFFICIENT" ONLY if the corpus meets all criteria and supports transferable customer truths.
- Output "INSUFFICIENT" if the evidence is completely irrelevant, trivial spam, vendor copy, too sparse, or dominated by untransferable single-brand disputes.

OUTPUT FORMAT (Strict JSON):
{
  "verdict": "SUFFICIENT" | "INSUFFICIENT",
  "reason": "Detailed rationale explaining why the corpus is sufficient or insufficient",
  "categoryRelevance": "HIGH" | "MEDIUM" | "LOW" | "IRRELEVANT",
  "buyerAuthenticity": "VERIFIED_BUYER" | "MIXED" | "NON_BUYER",
  "sourceConcentrationRisk": "HIGH_SINGLE_SOURCE" | "MODERATE" | "DIVERSE",
  "categoryBreadth": "BROAD_CATEGORY_TRUTHS" | "MIXED" | "SINGLE_BRAND_INCIDENT",
  "substantiveThemesFound": ["theme 1", "theme 2"]
}`;

  try {
    const runnerOutput = await generateWithRepair<string, MarketVoiceSufficiencyResult>({
      engineName: "AudienceEngine",
      touchpointName: "PrimaryMarketVoiceSufficiencyJudge",
      authoritativeInput: formattedQuotes,
      generate: async (input) => {
        const userPrompt = `Evaluate the following primary customer evidence corpus for semantic sufficiency:\n\n${input}`;

        const aiRes = await aiChat({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: "json_object" },
          endpoint: "audience-primary-market-voice-sufficiency-judge",
          accountId,
        });

        const text = aiRes.choices[0]?.message?.content || "{}";
        const parsed = safeJsonParse(text);
        const safe = marketVoiceSufficiencySchema.safeParse(parsed);
        if (!safe.success) {
          return {
            verdict: parsed?.verdict || "INVALID",
            reason: parsed?.reason || "Response failed schema validation",
            categoryRelevance: parsed?.categoryRelevance || "IRRELEVANT",
            buyerAuthenticity: parsed?.buyerAuthenticity || "NON_BUYER",
            sourceConcentrationRisk: parsed?.sourceConcentrationRisk || "HIGH_SINGLE_SOURCE",
            categoryBreadth: parsed?.categoryBreadth || "SINGLE_BRAND_INCIDENT",
            substantiveThemesFound: parsed?.substantiveThemesFound || [],
            isSufficient: false,
            _schemaErrors: safe.error.errors,
          } as any;
        }
        return {
          ...safe.data,
          isSufficient: safe.data.verdict === "SUFFICIENT",
        };
      },
      judge: async (_input, candidate: any) => {
        if (candidate?._schemaErrors && candidate._schemaErrors.length > 0) {
          return {
            valid: false,
            failureClass: "SCHEMA_INVALID",
            rejections: candidate._schemaErrors.map((e: any) => ({
              code: e.code || "SCHEMA_ERROR",
              message: `${e.path?.join(".") || "field"}: ${e.message}`,
            })),
          };
        }
        if (!candidate || typeof candidate.verdict !== "string") {
          return {
            valid: false,
            failureClass: "SCHEMA_INVALID",
            rejections: [{ code: "MISSING_VERDICT", message: "Response missing verdict field." }],
          };
        }
        if (candidate.verdict !== "SUFFICIENT" && candidate.verdict !== "INSUFFICIENT") {
          return {
            valid: false,
            failureClass: "SCHEMA_INVALID",
            rejections: [{ code: "INVALID_VERDICT", message: `Invalid verdict "${candidate.verdict}". Expected "SUFFICIENT" or "INSUFFICIENT".` }],
          };
        }
        return { valid: true };
      },
      repair: async (input, failedCandidate, rejections) => {
        const repairPrompt = `Your previous evaluation failed validation: ${rejections.map(r => r.message).join("; ")}.
Please re-evaluate the primary evidence corpus and output valid JSON conforming strictly to the schema.

Corpus:
${input}`;

        const aiRes = await aiChat({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: repairPrompt },
          ],
          temperature: 0.0,
          max_tokens: 2000,
          response_format: { type: "json_object" },
          endpoint: "audience-primary-market-voice-sufficiency-judge-repair",
          accountId,
        });

        const text = aiRes.choices[0]?.message?.content || "{}";
        const parsed = safeJsonParse(text);
        const safe = marketVoiceSufficiencySchema.safeParse(parsed);
        if (!safe.success) {
          return {
            verdict: parsed?.verdict || "INVALID",
            reason: parsed?.reason || "Response failed schema validation on repair",
            categoryRelevance: parsed?.categoryRelevance || "IRRELEVANT",
            buyerAuthenticity: parsed?.buyerAuthenticity || "NON_BUYER",
            sourceConcentrationRisk: parsed?.sourceConcentrationRisk || "HIGH_SINGLE_SOURCE",
            categoryBreadth: parsed?.categoryBreadth || "SINGLE_BRAND_INCIDENT",
            substantiveThemesFound: parsed?.substantiveThemesFound || [],
            isSufficient: false,
            _schemaErrors: safe.error.errors,
          } as any;
        }
        return {
          ...safe.data,
          isSufficient: safe.data.verdict === "SUFFICIENT",
        };
      },
      config: { maxRepairs: 2 },
    });

    return runnerOutput.result;
  } catch (err: any) {
    console.error(`[SufficiencyJudge] LLM Judge failed or exhausted: ${err?.message}`);
    // Fail closed
    return {
      isSufficient: false,
      verdict: "INSUFFICIENT",
      reason: `PRIMARY_MARKET_VOICE_INCOMPLETE: Sufficiency judge failed (${err?.message || "unknown error"}).`,
      categoryRelevance: "LOW",
      buyerAuthenticity: "MIXED",
      substantiveThemesFound: [],
    };
  }
}
