import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  funnelSnapshots,
} from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { aiChat } from "./ai-client";

interface NarrativeStep {
  key: string;
  label: string;
  icon: string;
  text: string;
  source: string;
}

interface CausalNarrative {
  hasNarrative: boolean;
  steps: NarrativeStep[];
  oneLiner: string;
  engineCount: number;
  completedAt: string | null;
  /**
   * T106 / CLP-02 — surfaces which narrative engine produced this run:
   *   - "template" : deterministic template-fill (default).
   *   - "llm_v2"   : grounded LLM rewrite (gate EXPO_PUBLIC_NARRATIVE_LLM_V2).
   *   - "llm_v2_failed_template_fallback" : LLM v2 was attempted but rejected
   *                                         (timeout/parse/grounding); we
   *                                         returned the template steps and
   *                                         logged the reason. NEVER silent.
   */
  narrativeMode?: "template" | "llm_v2" | "llm_v2_failed_template_fallback";
}

function safeP(v: any): any {
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}

function pick(obj: any, ...keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstItem(obj: any, ...keys: string[]): any {
  if (!obj) return null;
  for (const k of keys) {
    const raw = obj[k];
    const arr = typeof raw === "string" ? safeP(raw) : raw;
    if (Array.isArray(arr) && arr.length) return arr[0];
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + "…";
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthe market\s+(?:is\s+)?(?:currently\s+)?(?:dominated|saturated)\s+(?:by|with)\b/gi, "most brands rely on"],
  [/\bgeneric\s+(?:and\s+)?commoditized\b/gi, "generic"],
  [/\black\s+of\s+differentiation\b/gi, "no clear differentiator"],
  [/\bfailure\s+to\s+(?:adequately\s+)?address\b/gi, "not addressing"],
  [/\binability\s+to\b/gi, "can't"],
  [/\bdue\s+to\s+the\s+fact\s+that\b/gi, "because"],
  [/\bin\s+order\s+to\b/gi, "to"],
  [/\bleverage\b/gi, "use"],
  [/\butilize\b/gi, "use"],
  [/\bfacilitate\b/gi, "enable"],
  [/\boptimize\b/gi, "improve"],
  [/\bimplement\b/gi, "build"],
  [/\bestablish\b/gi, "create"],
  [/\bdemonstrate\b/gi, "show"],
  [/\bidentify\b/gi, "find"],
  [/\bprimary\s+differentiator\b/gi, "key advantage"],
  [/\bas\s+(?:a\s+)?primary\s+(?:strategic\s+)?advantage\b/gi, "as the edge"],
  [/\bstrategic\s+positioning\b/gi, "positioning"],
  [/\bstrategic\s+narrative\b/gi, "narrative"],
  [/\bstrategic\s+mechanism\b/gi, "mechanism"],
  [/\bcausal\s+reasoning\b/gi, "root cause"],
  [/\bsurface\s*-?\s*level\s+signals?\b/gi, "visible symptom"],
  [/\bmechanism\s+drives\s+the\s+fix\b/gi, "mechanism"],
  [/\b(?:Execute|Deploy)\s+(?:with|through|via)\s+/gi, ""],
  [/\s+funnel\s+funnel\b/g, " funnel"],
  [/\s{2,}/g, " "],
];

function humanize(text: string): string {
  if (!text || text.startsWith("Pending")) return text;

  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  out = out.replace(/^[a-z]/, c => c.toUpperCase());
  out = out.trim();

  return out;
}

export async function buildCausalNarrative(campaignId: string, accountId: string, requestedRunId: string | null = null): Promise<CausalNarrative & { runId?: string | null; isLatest?: boolean; isStale?: boolean }> {
  const empty: CausalNarrative = { hasNarrative: false, steps: [], oneLiner: "", engineCount: 0, completedAt: null };

  const { resolveRunId } = await import("./orchestrator/run-resolver");
  let resolved;
  try {
    resolved = await resolveRunId(campaignId, accountId, requestedRunId);
  } catch (e: any) {
    if (typeof e?.message === "string" && e.message.startsWith("RUN_NOT_FOUND")) throw e;
    return { ...empty, runId: null, isLatest: false, isStale: false };
  }
  const runId = resolved.runId;
  if (!runId) return { ...empty, runId: null, isLatest: true, isStale: false };

  // P3 isolation seal: scope orchestrator_jobs lookup by accountId AND
  // campaignId so a guessed/leaked runId from another tenant cannot return
  // section statuses or completion timestamps. resolveRunId already validates
  // ownership when a runId is supplied, but we defense-in-depth this raw read.
  const jobRows = await db.execute(
    sql`SELECT section_statuses, status, completed_at FROM orchestrator_jobs
        WHERE id = ${runId}
          AND account_id = ${accountId}
          AND campaign_id = ${campaignId}
        LIMIT 1`
  );
  const job = jobRows.rows?.[0];
  if (!job || !job.section_statuses) return { ...empty, runId, isLatest: resolved.isLatest, isStale: resolved.isStale };

  const sections: Array<{ id: string; status: string }> = safeP(job.section_statuses) || [];
  const completed = sections.filter(s => s.status === "SUCCESS" || s.status === "COMPLETE");
  if (completed.length < 3) return { ...empty, runId, isLatest: resolved.isLatest, isStale: resolved.isStale };

  const completedIds = new Set(completed.map(s => s.id));

  const [posRows, diffRows, mechRows, offerRows, funnelRows] = await Promise.all([
    db.select().from(positioningSnapshots)
      .where(and(
        eq(positioningSnapshots.campaignId, campaignId),
        eq(positioningSnapshots.accountId, accountId),
        eq(positioningSnapshots.jobId, runId),
      ))
      .limit(1)
      .catch(() => []),

    completedIds.has("differentiation")
      ? db.select().from(differentiationSnapshots)
          .where(and(
            eq(differentiationSnapshots.campaignId, campaignId),
            eq(differentiationSnapshots.accountId, accountId),
            eq(differentiationSnapshots.jobId, runId),
          ))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("mechanism")
      ? db.select().from(mechanismSnapshots)
          .where(and(
            eq(mechanismSnapshots.campaignId, campaignId),
            eq(mechanismSnapshots.accountId, accountId),
            eq(mechanismSnapshots.jobId, runId),
          ))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("offer")
      ? db.select().from(offerSnapshots)
          .where(and(
            eq(offerSnapshots.campaignId, campaignId),
            eq(offerSnapshots.accountId, accountId),
            eq(offerSnapshots.jobId, runId),
          ))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),

    completedIds.has("funnel")
      ? db.select().from(funnelSnapshots)
          .where(and(
            eq(funnelSnapshots.campaignId, campaignId),
            eq(funnelSnapshots.accountId, accountId),
            eq(funnelSnapshots.jobId, runId),
          ))
          .limit(1)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  let aelData: any = null;
  try {
    if (!resolved.runId) throw new Error("no_run");
    const aelRows = await db.execute(
      sql`SELECT root_causes, causal_chains, buying_barriers
          FROM ael_snapshots WHERE campaign_id = ${campaignId} AND account_id = ${accountId} AND job_id = ${resolved.runId} LIMIT 1`
    );
    if (aelRows.rows?.[0]) {
      aelData = {
        rootCauses: safeP(aelRows.rows[0].root_causes) || [],
        causalChains: safeP(aelRows.rows[0].causal_chains) || [],
        buyingBarriers: safeP(aelRows.rows[0].buying_barriers) || [],
      };
    }
  } catch {}

  const posRow = posRows[0] || null;
  const diffRow = diffRows[0] || null;
  const mechRow = mechRows[0] || null;
  const offerRow = offerRows[0] || null;
  const funnelRow = funnelRows[0] || null;

  const primaryTerritory = safeP(posRow?.territory) || firstItem({ territories: posRow?.territories }, "territories");
  const territoryName = primaryTerritory?.name || primaryTerritory?.territoryName || null;
  const enemy = primaryTerritory?.enemyDefinition
    || (posRow?.enemyDefinition ? posRow.enemyDefinition : null)
    || pick(primaryTerritory, "enemy") || null;
  const contrastAxis = primaryTerritory?.contrastAxis
    || (posRow?.contrastAxis ? posRow.contrastAxis : null) || null;
  const narrativeDirection = primaryTerritory?.narrativeDirection
    || (posRow?.narrativeDirection ? posRow.narrativeDirection : null) || null;

  let problemText: string | null = null;
  let problemSource = "positioning";

  if (enemy) {
    problemText = enemy;
  } else if (contrastAxis) {
    problemText = contrastAxis;
  } else if (narrativeDirection) {
    problemText = narrativeDirection;
  }

  if (!problemText && aelData?.rootCauses?.[0]) {
    const rc = aelData.rootCauses[0];
    problemText = rc.deepCause || rc.surfaceSignal || null;
    problemSource = "ael";
  }

  if (!problemText) {
    problemText = "Pending — run strategic engines to identify market problem";
    problemSource = "none";
  }

  let whyText: string | null = null;
  let whySource = "ael";

  if (aelData?.causalChains?.[0]) {
    const cc = aelData.causalChains[0];
    whyText = cc.cause || cc.impact || null;
  }
  if (!whyText && aelData?.rootCauses?.[0]) {
    whyText = aelData.rootCauses[0].causalReasoning || aelData.rootCauses[0].deepCause || null;
  }
  if (!whyText && aelData?.buyingBarriers?.[0]) {
    const bb = aelData.buyingBarriers[0];
    whyText = bb.rootCause || bb.barrier || null;
  }

  if (!whyText && contrastAxis) {
    whyText = contrastAxis;
    whySource = "positioning";
  }

  if (!whyText && enemy) {
    whyText = enemy;
    whySource = "positioning";
  }

  if (!whyText) {
    whyText = "Pending — AEL root cause analysis needed";
    whySource = "none";
  }

  let whatWeDoText: string;
  let positionSource = "positioning";
  if (territoryName && enemy) {
    whatWeDoText = `Own "${territoryName}" — fight ${enemy}`;
  } else if (territoryName) {
    whatWeDoText = `Own the "${territoryName}" territory`;
  } else {
    whatWeDoText = "Pending — positioning engine output needed";
    positionSource = "none";
  }

  const mechObj = safeP(mechRow?.primaryMechanism) || {};
  const mechName = pick(mechObj, "mechanismName") || null;
  const mechType = pick(mechObj, "mechanismType") || null;

  const diffPillars = safeP(diffRow?.differentiationPillars) || [];
  const topPillar = Array.isArray(diffPillars) && diffPillars[0]
    ? (diffPillars[0].name || diffPillars[0].pillarName)
    : null;
  const authorityModeRaw = safeP(diffRow?.authorityMode);
  const authorityMode = typeof authorityModeRaw === "object"
    ? authorityModeRaw?.mode
    : (typeof authorityModeRaw === "string" ? authorityModeRaw : null);

  let howText: string;
  let howSource = "mechanism";
  if (mechName && topPillar) {
    howText = `"${mechName}" mechanism — anchored on ${topPillar}`;
  } else if (mechName && mechType) {
    howText = `"${mechName}" (${mechType}) mechanism`;
  } else if (mechName) {
    howText = `"${mechName}" mechanism drives the fix`;
  } else if (topPillar && authorityMode) {
    howText = `${authorityMode} authority — lead with "${topPillar}"`;
    howSource = "differentiation";
  } else if (topPillar) {
    howText = `Lead with "${topPillar}" as primary differentiator`;
    howSource = "differentiation";
  } else {
    howText = "Pending — mechanism and differentiation engines needed";
    howSource = "none";
  }

  const funnelObj = safeP(funnelRow?.primaryFunnel) || {};
  const funnelType = pick(funnelObj, "funnelType", "funnelName") || null;
  const offerObj = safeP(offerRow?.primaryOffer) || {};
  const offerName = pick(offerObj, "offerName") || null;
  const coreOutcome = pick(offerObj, "coreOutcome") || null;

  let executeText: string;
  let executeSource = "offer+funnel";
  if (offerName && funnelType && coreOutcome) {
    executeText = `"${offerName}" → ${funnelType} funnel → ${coreOutcome}`;
  } else if (offerName && funnelType) {
    executeText = `"${offerName}" offer → ${funnelType} funnel`;
  } else if (offerName && coreOutcome) {
    executeText = `"${offerName}" → ${coreOutcome}`;
  } else if (offerName) {
    executeText = `"${offerName}" offer`;
  } else if (funnelType) {
    executeText = `Execute through ${funnelType} funnel`;
  } else {
    executeText = "Pending — offer and funnel engines needed";
    executeSource = "none";
  }

  const steps: NarrativeStep[] = [
    { key: "problem", label: "Market Problem", icon: "alert-circle-outline", text: humanize(problemText), source: problemSource },
    { key: "why", label: "Why It Happens", icon: "git-branch-outline", text: humanize(whyText), source: whySource },
    { key: "position", label: "What We Do", icon: "flag-outline", text: humanize(whatWeDoText), source: positionSource },
    { key: "mechanism", label: "How We Fix It", icon: "construct-outline", text: humanize(howText), source: howSource },
    { key: "execute", label: "What To Execute", icon: "rocket-outline", text: humanize(executeText), source: executeSource },
  ];

  const oneLiner = `${humanize(problemText)} → ${humanize(whatWeDoText)} → ${humanize(executeText)}`;

  // -------------------------------------------------------------------------
  // T106 / CLP-02 — narrative LLM v2 (gated).
  //
  // When EXPO_PUBLIC_NARRATIVE_LLM_V2 is truthy and we have enough grounded
  // evidence (≥3 completed engines, problem + position not "none"), ask the
  // LLM to *refine* — not invent — each of the 5 steps. The prompt locks the
  // model to the evidence we already extracted; outputs that hallucinate
  // names/territories not present are rejected (template steps stand).
  //
  // The call goes through `aiChat` which auto-flows into the replay recorder
  // via AsyncLocalStorage (`getCurrentRecorder()?.recordLlmCall`) when the
  // narrative builder runs inside a `runOrchestrator` scope. No extra
  // withReplayRecorder wrapping is needed at this seam.
  // -------------------------------------------------------------------------
  let llmSteps: NarrativeStep[] | null = null;
  let llmOneLiner: string | null = null;
  let narrativeMode: "template" | "llm_v2" | "llm_v2_failed_template_fallback" = "template";

  const llmGateOn = ["1", "true", "on", "yes"].includes(
    String(process.env.EXPO_PUBLIC_NARRATIVE_LLM_V2 ?? "").trim().toLowerCase(),
  );
  const hasEnoughEvidence =
    completed.length >= 3 && problemSource !== "none" && positionSource !== "none";

  if (llmGateOn && hasEnoughEvidence) {
    try {
      const evidence = {
        territoryName, enemy, contrastAxis, narrativeDirection,
        mechanismName: mechName, mechanismType: mechType, topPillar, authorityMode,
        offerName, coreOutcome, funnelType,
        rootCause: aelData?.rootCauses?.[0] ?? null,
        causalChain: aelData?.causalChains?.[0] ?? null,
        templateSteps: steps.map(s => ({ key: s.key, label: s.label, text: s.text })),
      };
      const sys = "You are a brand strategist. Rewrite each of the 5 causal narrative steps into ONE short sentence (≤16 words) using plain language. Use ONLY the provided evidence — do NOT invent territories, mechanisms, or claims that are not in the evidence. If a step's evidence is 'Pending' or empty, copy the template text verbatim. Return STRICT JSON: { steps: [{key, text}], oneLiner }.";
      const user = JSON.stringify({ evidence });
      const completion = await aiChat({
        accountId,
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        max_tokens: 600,
        temperature: 0.4,
        response_format: { type: "json_object" } as any,
      } as any);
      const raw = completion?.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      const stepArr: Array<{ key: string; text: string }> = Array.isArray(parsed?.steps) ? parsed.steps : [];
      const byKey: Record<string, string> = {};
      for (const s of stepArr) {
        if (typeof s?.key === "string" && typeof s?.text === "string" && s.text.trim()) {
          byKey[s.key] = s.text.trim();
        }
      }
      // Grounding gate (CLP-02 / P1 fail-closed):
      //   1. all 5 keys present
      //   2. every quoted "..." substring is in the evidence-anchored allowlist
      //   3. every Capitalized multi-word ProperNoun chunk is either a single
      //      common word (allowed) OR appears in the evidence allowlist. This
      //      catches unquoted invented brand/territory names that the prior
      //      gate let through.
      //   4. the model's oneLiner is DISCARDED — we always synthesize it
      //      from the validated steps so an unchecked free-text headline
      //      can't smuggle hallucinations past the per-step gate.
      const allKeysCovered = ["problem","why","position","mechanism","execute"].every(k => byKey[k]);
      const anchorTerms = [territoryName, mechName, offerName, topPillar, enemy, contrastAxis]
        .filter(Boolean).map(s => String(s).toLowerCase());
      const allowedQuoted = new Set(anchorTerms);
      // Tokenize each anchor term into individual words so multi-word
      // anchors like "Forecast Accuracy Engine" allow each component word.
      const allowedTokens = new Set<string>();
      for (const t of anchorTerms) {
        for (const w of t.split(/\s+/)) {
          if (w.length >= 2) allowedTokens.add(w.toLowerCase());
        }
      }
      const QUOTED_RE = /"([^"]{2,60})"/g;
      // Match runs of ≥2 consecutive Capitalized words (likely proper nouns)
      // — single capitalized words at sentence-start are not flagged.
      const CAP_RUN_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
      // Tighter check (architect P1 follow-up): single Capitalized words that
      // do NOT sit at sentence-start. Catches "Clari", "Gong"-style invented
      // brand tokens that the multi-word run regex misses. We allow a small
      // set of always-acceptable single-word common nouns/prepositions that
      // legitimately start mid-sentence (e.g., months, weekdays, "I"). The
      // anchor allowlist already covers real brand names from evidence.
      const SINGLE_CAP_MID_RE = /(?<=[a-z0-9,;:)\]"'\s])\s([A-Z][a-z]{2,})\b/g;
      const SINGLE_CAP_ALLOWED = new Set<string>([
        "i","a","january","february","march","april","may","june","july","august",
        "september","october","november","december","monday","tuesday","wednesday",
        "thursday","friday","saturday","sunday","instagram","facebook","tiktok",
        "linkedin","twitter","x","youtube","google",
      ]);
      let groundingOk = allKeysCovered;
      let rejectReason: string | null = null;
      if (groundingOk) {
        for (const k of Object.keys(byKey)) {
          const txt = byKey[k];
          // Check 2: quoted strings
          let qm: RegExpExecArray | null;
          QUOTED_RE.lastIndex = 0;
          while ((qm = QUOTED_RE.exec(txt)) !== null) {
            if (!allowedQuoted.has(qm[1].trim().toLowerCase())) {
              groundingOk = false; rejectReason = `quoted_unanchored:${qm[1].slice(0, 40)}`; break;
            }
          }
          if (!groundingOk) break;
          // Check 3: capitalized-word runs (proper nouns)
          let cm: RegExpExecArray | null;
          CAP_RUN_RE.lastIndex = 0;
          while ((cm = CAP_RUN_RE.exec(txt)) !== null) {
            const phrase = cm[1].toLowerCase();
            if (allowedQuoted.has(phrase)) continue;
            // Every word in the capitalized run must appear in the anchor
            // token set (i.e. evidence-grounded). Even one unknown word
            // rejects the entire run — and the entire LLM attempt.
            const words = phrase.split(/\s+/);
            const allKnown = words.every(w => allowedTokens.has(w));
            if (!allKnown) {
              groundingOk = false;
              rejectReason = `unanchored_proper_noun:${cm[1].slice(0, 40)}`;
              break;
            }
          }
          if (!groundingOk) break;
          // Check 4 (architect P1 follow-up): single Capitalized mid-sentence
          // tokens that are not in the evidence anchor set.
          let sm: RegExpExecArray | null;
          SINGLE_CAP_MID_RE.lastIndex = 0;
          while ((sm = SINGLE_CAP_MID_RE.exec(txt)) !== null) {
            const tok = sm[1].toLowerCase();
            if (allowedTokens.has(tok)) continue;
            if (SINGLE_CAP_ALLOWED.has(tok)) continue;
            groundingOk = false;
            rejectReason = `unanchored_single_proper_noun:${sm[1].slice(0, 40)}`;
            break;
          }
          if (!groundingOk) break;
        }
      }
      if (groundingOk) {
        llmSteps = steps.map(s => ({ ...s, text: humanize(byKey[s.key] ?? s.text) }));
        // oneLiner is ALWAYS synthesized from validated steps (model's
        // free-text oneLiner is discarded — see gate doc above).
        llmOneLiner = `${llmSteps[0].text} → ${llmSteps[2].text} → ${llmSteps[4].text}`;
        narrativeMode = "llm_v2";
      } else {
        narrativeMode = "llm_v2_failed_template_fallback";
        console.warn(`[Narrative] LLM_V2_GROUNDING_REJECTED | runId=${runId} keysCovered=${allKeysCovered} reason=${rejectReason ?? "unknown"}`);
      }
    } catch (err: any) {
      narrativeMode = "llm_v2_failed_template_fallback";
      console.warn(`[Narrative] LLM_V2_CALL_FAILED | runId=${runId} reason=${err?.message ?? err}`);
    }
  }

  return {
    hasNarrative: true,
    steps: llmSteps ?? steps,
    oneLiner: llmOneLiner ?? oneLiner,
    engineCount: completed.length,
    completedAt: job.completed_at ? String(job.completed_at) : null,
    narrativeMode,
    runId,
    isLatest: resolved.isLatest,
    isStale: resolved.isStale,
  };
}
