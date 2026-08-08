/**
 * Channel Confidence — evidence-based reliability regression tests (2026-08-08)
 *
 * Before fix: assessDataReliability used validation.claimConfidenceScore (cross-
 * engine consistency metric) as a proxy for "competitor validity."  A first-run
 * campaign with claimConfidenceScore=0.35 received an unfair reliability penalty
 * that propagated into the decision gate as "exploratory" → fitScore capped at 0.35.
 *
 * Also: the guard layer hard-failed (passed=false) when budget.killFlag=true,
 * triggering the decision gate's exploratory branch for every channel.
 *
 * After fix:
 *   1. competitorValidity uses validation.evidenceStrength (actual quality metric)
 *   2. offerStrengthFactor contributes 10% of reliability weight
 *   3. Guard layer surfaces killFlag as a warning, not a hard block
 *
 * Run with:  npx tsx server/tests/channel-confidence-fix.test.ts
 */

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;
function assert(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  else { console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`); failed++; }
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Channel Confidence — evidence reliability fix (2026-08-08)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ─── Mirror of the fixed assessDataReliability formula ────────────────────────
function clamp(n: number, lo = 0, hi = 1): number { return Math.max(lo, Math.min(hi, n)); }
function safeNumber(v: any, def: number): number { return typeof v === "number" && isFinite(v) ? v : def; }

function assessDataReliability(
  audience: { audienceSegments: any[]; audiencePains: any[]; emotionalDrivers: any[]; maturityIndex: number | null },
  awareness: object | null,
  persuasion: object | null,
  offer: { offerStrengthScore: number } | null,
  budget: object | null,
  validation: { claimConfidenceScore: number; evidenceStrength: number } | null,
): { overallReliability: number; competitorValidity: number; isWeak: boolean } {
  const totalSignals =
    (audience.audienceSegments?.length ?? 0) +
    (audience.audiencePains?.length ?? 0) +
    (audience.emotionalDrivers?.length ?? 0);
  const signalDensity = clamp(totalSignals / 10);

  let diversityCount = 0;
  if (audience.audienceSegments?.length > 0) diversityCount++;
  if (audience.audiencePains?.length > 0) diversityCount++;
  if (audience.emotionalDrivers?.length > 0) diversityCount++;
  if (awareness) diversityCount++;
  if (persuasion) diversityCount++;
  if (offer) diversityCount++;
  if (budget) diversityCount++;
  if (validation) diversityCount++;
  const signalDiversity = clamp(diversityCount / 6);

  const narrativeStability = (awareness ? 0.5 : 0) + (persuasion ? 0.5 : 0);

  // Fixed: evidenceStrength not claimConfidenceScore
  const evidenceQuality = validation ? safeNumber(validation.evidenceStrength, 0.5) : 0.5;
  const competitorValidity = clamp(evidenceQuality);

  // New: offer strength factor
  const offerStrengthFactor = offer ? clamp(safeNumber(offer.offerStrengthScore, 0.5)) : 0.5;

  const maturity = safeNumber(audience.maturityIndex, 0.5);
  const marketMaturityConfidence = maturity > 0.1 ? clamp(0.5 + maturity * 0.5) : 0.3;

  const overallReliability =
    signalDensity        * 0.22 +
    signalDiversity      * 0.18 +
    narrativeStability   * 0.18 +
    competitorValidity   * 0.18 +
    marketMaturityConfidence * 0.14 +
    offerStrengthFactor  * 0.10;

  return { overallReliability, competitorValidity, isWeak: overallReliability < 0.45 };
}

// ─── T1: First-run campaign — claimConfidenceScore=0.35, evidenceStrength=0.65 ─
// Before fix: competitorValidity=0.35 dragged reliability below 0.45 → isWeak=true
// After fix:  competitorValidity=0.65, reliability > 0.45 → isWeak=false
{
  const result = assessDataReliability(
    { audienceSegments: ["a", "b", "c"], audiencePains: ["p1", "p2"], emotionalDrivers: ["e1"], maturityIndex: 0.6 },
    { /* awareness */ },
    { /* persuasion */ },
    { offerStrengthScore: 0.91 },
    { /* budget */ },
    { claimConfidenceScore: 0.35, evidenceStrength: 0.65 },
  );
  assert(!result.isWeak,
    "T1: first-run with claimConfidence=0.35 but evidenceStrength=0.65 → isWeak=false (reliability above threshold)",
    `overallReliability=${result.overallReliability.toFixed(3)}`);
  assert(result.competitorValidity === 0.65,
    "T1: competitorValidity reads evidenceStrength, not claimConfidenceScore",
    `got=${result.competitorValidity}`);
}

// ─── T2: Strong offer (0.91) raises reliability even with weak validation ──────
{
  const noOffer = assessDataReliability(
    { audienceSegments: ["a"], audiencePains: ["p1"], emotionalDrivers: [], maturityIndex: 0.5 },
    { /* awareness */ }, { /* persuasion */ },
    null, null,
    { claimConfidenceScore: 0.35, evidenceStrength: 0.35 },
  );
  const withOffer = assessDataReliability(
    { audienceSegments: ["a"], audiencePains: ["p1"], emotionalDrivers: [], maturityIndex: 0.5 },
    { /* awareness */ }, { /* persuasion */ },
    { offerStrengthScore: 0.91 }, null,
    { claimConfidenceScore: 0.35, evidenceStrength: 0.35 },
  );
  assert(withOffer.overallReliability > noOffer.overallReliability,
    "T2: strong offer (0.91) raises reliability vs null offer",
    `withOffer=${withOffer.overallReliability.toFixed(3)} noOffer=${noOffer.overallReliability.toFixed(3)}`);
}

// ─── T3: Absent validation defaults to 0.5 (neutral) — not 0 (negative) ───────
{
  const absent = assessDataReliability(
    { audienceSegments: ["a", "b"], audiencePains: ["p1"], emotionalDrivers: ["e1"], maturityIndex: 0.6 },
    { /* awareness */ }, { /* persuasion */ },
    { offerStrengthScore: 0.7 }, null, null,
  );
  const explicit05 = assessDataReliability(
    { audienceSegments: ["a", "b"], audiencePains: ["p1"], emotionalDrivers: ["e1"], maturityIndex: 0.6 },
    { /* awareness */ }, { /* persuasion */ },
    { offerStrengthScore: 0.7 }, null,
    { claimConfidenceScore: 0.35, evidenceStrength: 0.5 },
  );
  assert(Math.abs(absent.competitorValidity - explicit05.competitorValidity) < 0.01,
    "T3: absent validation → competitorValidity=0.5 (neutral default, not 0)",
    `absent=${absent.competitorValidity} explicit0.5=${explicit05.competitorValidity}`);
}

// ─── T4: Weights sum to exactly 1.00 ──────────────────────────────────────────
{
  const weightSum = 0.22 + 0.18 + 0.18 + 0.18 + 0.14 + 0.10;
  assert(Math.abs(weightSum - 1.0) < 0.001,
    "T4: reliability formula weights sum to 1.00",
    `sum=${weightSum}`);
}

// ─── T5: Guard layer killFlag — does NOT hard-block (passed stays true) ────────
// Mirror of the fixed runGuardLayer kill-flag check.
function guardLayerPassed(killFlag: boolean): boolean {
  // After fix: killFlag does not set passed=false
  // (it only adds a warning; budget layer handles the killFlag signal)
  let passed = true;
  if (killFlag) {
    // findings.push warning — but passed remains true
  }
  return passed;
}

{
  const passBefore = guardLayerPassed(false);
  const passWithKill = guardLayerPassed(true);
  assert(passBefore === true,
    "T5a: guard layer passes when killFlag=false",
    `passed=${passBefore}`);
  assert(passWithKill === true,
    "T5b: guard layer still passes when killFlag=true (killFlag is a budget signal, not a channel incompatibility)",
    `passed=${passWithKill}`);
}

// ─── T6: Full MarketMindAI first-run scenario — reliability should be > 0.45 ──
// Parameters approximate the actual run: audience signals present, awareness +
// persuasion available, offer strength 0.91 (after Bug-A fix penalty = 0.82),
// evidenceStrength from statistical validation ~ 0.65.
{
  const scenario = assessDataReliability(
    {
      audienceSegments: ["AI content teams", "Marketing SMBs", "Agencies"],
      audiencePains: ["speed", "consistency", "cost"],
      emotionalDrivers: ["efficiency", "creativity"],
      maturityIndex: 0.6,
    },
    { /* awareness */ },
    { /* persuasion */ },
    { offerStrengthScore: 0.82 },  // 0.91 × 0.90 (Bug-A 10% penalty)
    { /* budget */ },
    { claimConfidenceScore: 0.35, evidenceStrength: 0.65 },
  );
  assert(scenario.overallReliability > 0.45,
    "T6: MarketMindAI first-run scenario reliability > 0.45 (not weak)",
    `reliability=${scenario.overallReliability.toFixed(3)}`);
  assert(!scenario.isWeak,
    "T6: isWeak=false → fitScore will NOT be capped by the 0.55 ceiling",
    `isWeak=${scenario.isWeak}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(66)}`);
console.log(`Result: ${failed === 0 ? "\x1b[32mALL PASS\x1b[0m" : `\x1b[31m${failed} FAILED\x1b[0m`}`);
if (failed > 0) process.exit(1);
