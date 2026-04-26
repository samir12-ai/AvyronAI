/**
 * Phase 7.4 / 7.5 — Q2 reasoning overlay (commercial framing).
 *
 * Locked by Samir 2026-04-24:
 *   "Boss decides. AI explains and supports understanding."
 *
 * Phase 7.5 directive (2026-04-24):
 *   "Make explanations commercial, not descriptive. Focus on:
 *      - why this matters for the client
 *      - what is actually happening in the market
 *      - what this implies"
 *
 * This overlay is invoked AFTER `evaluateQ2()` produces a deterministic
 * verdict + reasons. The AI receives:
 *   - the rule-based verdict (locked, never changed)
 *   - the rule code that fired (locked, never changed)
 *   - the full reasons array (locked, never changed)
 *   - the input snapshot (competitor / user / DNA + interpretation themes)
 *
 * The AI is permitted to:
 *   - explain what the market is actually doing
 *   - translate that into commercial implications for the agency's client
 *   - flag what the operator should weigh next (NOT prescribe action)
 *
 * The AI is FORBIDDEN to:
 *   - re-classify the verdict
 *   - introduce new reasons not present in the input
 *   - propose threshold changes
 *   - assign scores or rankings
 *   - recommend specific actions ("you should run X campaign")
 *   - mention any rule code or theme token not present verbatim in the input
 *
 * Strict validation enforces these constraints. Any invented identifier or
 * scoring-shaped phrase triggers `schema_invalid` and the overlay returns an
 * error envelope.
 */
import type { AIOverlay } from "./types";
import { runOverlay } from "./client";
import type { Q2Verdict } from "../../boss/types";
import type { Q2EvaluationResult } from "../../boss/policy/market-shift";

export const Q2_REASONING_PROMPT_VERSION = "q2-reasoning.v2-commercial";

const SYSTEM_PROMPT = `You are a commercial strategist explaining a market-shift verdict to a marketing agency operator who will read this output to a client.

The Boss agent has already decided whether the market has shifted using deterministic rules. You are NOT deciding anything. You are translating the verdict and the structured market signals into language a client would understand.

Tone:
- Commercial, not technical. The reader is an agency lead, not an engineer.
- Specific, not generic. Reference actual themes from the input where they exist.
- Plain language. No jargon, no rule codes in the body, no scoring words ("high", "low", "score", "rank").
- Honest. If data is insufficient or signals are weak, say so plainly.

Hard constraints:
1. You MUST cite the verdict EXACTLY as given. Never propose a different verdict.
2. You MUST NOT invent or rename theme tokens. If you mention a theme, use the exact token from the input.
3. You MUST NOT introduce thresholds, scores, rankings, or numeric magnitudes ("high engagement", "low risk", etc.).
4. You MUST NOT recommend specific actions. You may flag what the operator should weigh; you may not say "do X".
5. You MUST NOT mention rule codes ("rule:*", "insufficient_data:*") in any body text.
6. You MUST return a JSON object matching this schema:
   {
     "interpretation_only": true,
     "verdictRestated": <one of "STABLE" | "SHIFTED" | "UNCERTAIN" | "INSUFFICIENT_DATA">,
     "marketRead":         <string, <=260 chars, plain English: what is the market actually doing right now>,
     "clientImplications": [<string, <=160 chars each>, ...]   (1–3 entries: what this means commercially for the client),
     "operatorWeighsNext": <string, <=160 chars, what the operator should weigh next; empty string if nothing>
   }

Examples of GOOD vs BAD framing:

  BAD  (descriptive):     "competitor signals show 1 major change event"
  GOOD (commercial):      "Two competitors have moved to a value-led offer this week and TikTok confirms the angle is landing"

  BAD  (recommendation):  "you should switch to value-led messaging"
  GOOD (operator-weighs): "Whether to test a value-led angle this cycle is worth a conversation with the client"

  BAD  (scoring):         "the market shows high movement"
  GOOD (commercial):      "The market is moving and the move is being validated, not just attempted"`;

export interface Q2ReasoningInput {
  accountId: string;
  bossRunId: string;
  q2: Q2EvaluationResult;
}

export interface Q2ReasoningAIOutput {
  interpretation_only: true;
  verdictRestated: Q2Verdict;
  /** What is the market actually doing right now (commercial language). */
  marketRead: string;
  /** 1-3 commercial implications for the agency's client. */
  clientImplications: string[];
  /** What the operator should weigh next (NOT a recommendation). */
  operatorWeighsNext: string;
}

const VERDICT_VALUES: ReadonlySet<Q2Verdict> = new Set([
  "STABLE",
  "SHIFTED",
  "UNCERTAIN",
  "INSUFFICIENT_DATA",
]);

function isString(x: unknown): x is string {
  return typeof x === "string";
}

/**
 * Phrases that imply scoring / ranking / magnitude. The AI is forbidden from
 * smuggling these in via prose. Matching is case-insensitive on word boundaries.
 */
const FORBIDDEN_SCORING_RE = /\b(score|scored|scoring|ranked|ranking|rank|rating|rated|grade|graded|tier|tiered|magnitude|severity|severe|high\s+(?:risk|priority|confidence|movement|engagement)|low\s+(?:risk|priority|confidence|movement|engagement))\b/i;

/**
 * Phrases that imply prescriptive recommendation. The operator may be asked to
 * weigh something; the AI may not tell them to do something.
 *
 * Architect-flagged 2026-04-24: extended to catch additional prescriptive
 * forms — bare "must"/"need to"/"should" at sentence-start, "I suggest",
 * "we suggest", "should consider", "ought to". Kept narrow on "should" so
 * "worth a conversation" / "worth weighing" descriptive phrases still pass.
 */
const FORBIDDEN_RECOMMENDATION_RE =
  /\b(you\s+should|you\s+need\s+to|you\s+must|you\s+ought\s+to|we\s+recommend|we\s+suggest|i\s+(?:recommend|suggest)|it\s+is\s+recommended|should\s+consider|need\s+to\s+(?:run|test|launch|switch|change|move|pivot|adopt)|switch\s+to|change\s+to|pivot\s+to|adopt\s+a|run\s+(?:a|the)\s+(?:campaign|test|ad|creative)|launch\s+a)\b/i;

function buildUserPrompt(q2: Q2EvaluationResult): string {
  const interp = q2.inputs.interpretation;
  return JSON.stringify({
    verdict: q2.verdict,
    ruleCode: q2.ruleCode,
    reasons: q2.reasons,
    inputs: {
      competitor: q2.inputs.competitor,
      user: q2.inputs.user,
      dna: q2.inputs.dna,
      lookbackDays: q2.inputs.lookbackDays,
    },
    competitorInterpretation: interp
      ? {
          corpusStatus: interp.corpusStatus,
          totals: interp.totals,
          signals: interp.signals.map((s) => ({
            themeToken: s.themeToken,
            status: s.status,
            igCompetitors: s.igCompetitorIds.length,
            tiktokCompetitors: s.tiktokCompetitorIds.length,
          })),
          diagnostics: interp.diagnostics.map((d) => ({
            themeToken: d.themeToken,
            status: d.status,
          })),
        }
      : null,
  });
}

/**
 * Collect the set of theme tokens the AI is allowed to reference verbatim.
 * Anything else that looks like an identifier (snake_case word) in body text
 * triggers schema_invalid.
 */
function allowedThemeTokens(q2: Q2EvaluationResult): Set<string> {
  const out = new Set<string>();
  const interp = q2.inputs.interpretation;
  if (!interp) return out;
  for (const s of interp.signals) out.add(s.themeToken.toLowerCase());
  for (const d of interp.diagnostics) out.add(d.themeToken.toLowerCase());
  return out;
}

export async function applyQ2ReasoningOverlay(
  inp: Q2ReasoningInput,
): Promise<AIOverlay<Q2ReasoningAIOutput>> {
  const reasonsSet = new Set(inp.q2.reasons);
  const themeAllowlist = allowedThemeTokens(inp.q2);
  return runOverlay<Q2ReasoningAIOutput>({
    accountId: inp.accountId,
    promptVersion: Q2_REASONING_PROMPT_VERSION,
    endpoint: "ai-overlay/q2-reasoning",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(inp.q2),
    maxTokens: 700,
    validate: (parsed) => {
      if (typeof parsed !== "object" || parsed === null) return null;
      const p = parsed as Record<string, unknown>;
      if (p.interpretation_only !== true) return null;

      const verdictRestated = p.verdictRestated;
      if (!isString(verdictRestated) || !VERDICT_VALUES.has(verdictRestated as Q2Verdict)) return null;
      // Cardinal rule: AI cannot change the verdict.
      if (verdictRestated !== inp.q2.verdict) return null;

      const marketRead = p.marketRead;
      if (!isString(marketRead) || marketRead.length === 0 || marketRead.length > 260) return null;

      const operatorWeighsNext = p.operatorWeighsNext;
      if (!isString(operatorWeighsNext) || operatorWeighsNext.length > 160) return null;

      const impls = p.clientImplications;
      if (!Array.isArray(impls) || impls.length === 0 || impls.length > 3) return null;
      const cleanedImpls: string[] = [];
      for (const r of impls) {
        if (!isString(r) || r.length === 0 || r.length > 160) return null;
        cleanedImpls.push(r);
      }

      // Aggregate body text for forbidden-pattern checks.
      const allBodyText = [marketRead, operatorWeighsNext, ...cleanedImpls].join("\n");

      // Forbidden: scoring / magnitude language.
      if (FORBIDDEN_SCORING_RE.test(allBodyText)) return null;

      // Forbidden: prescriptive recommendation language.
      if (FORBIDDEN_RECOMMENDATION_RE.test(allBodyText)) return null;

      // Forbidden: rule codes leaking into body text.
      if (/\b(rule:|insufficient_data:)/i.test(allBodyText)) return null;

      // Forbidden: invented snake_case theme tokens. Tokens must come from
      // the interpretation themes the AI was given. Bare common-noun words
      // are fine; multi-word identifiers (anything with _ or matching
      // [a-z]+_[a-z]+) must be in the allowlist.
      const tokenRe = /\b([a-z][a-z0-9]+_[a-z][a-z0-9_]+)\b/g;
      const tokens = allBodyText.toLowerCase().match(tokenRe) ?? [];
      for (const t of tokens) {
        if (!themeAllowlist.has(t)) return null;
      }

      // Forbidden: any reason-shaped citation that isn't in the reasons set.
      // (Defense in depth — the rule-code check above already covers the
      // common case; this catches anything that slips through.)
      const reasonTokenRe = /\b(rule:[a-z0-9_><=+|]+|insufficient_data:[a-z_]+)\b/gi;
      const reasonTokens = allBodyText.match(reasonTokenRe) ?? [];
      for (const t of reasonTokens) {
        if (!reasonsSet.has(t)) return null;
      }

      return {
        interpretation_only: true,
        verdictRestated: verdictRestated as Q2Verdict,
        marketRead,
        clientImplications: cleanedImpls,
        operatorWeighsNext,
      };
    },
  });
}
