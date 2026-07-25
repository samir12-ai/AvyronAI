/**
 * Phase 7.5 — Real-scenario validation harness for Q2 + competitor interpretation.
 *
 * Locked by Samir 2026-04-24:
 *   "Start testing this with real cases. Validate decision correctness,
 *    explanation clarity, no contradictions."
 *
 * This harness exercises the FULL Q2 path end-to-end:
 *   1. Build a realistic CompetitorPost[] for the scenario (per-competitor,
 *      per-channel, per-theme — exactly the shape Samir asked for).
 *   2. Run `interpretCompetitorPosts()` to get the structured interpretation.
 *   3. Run `decideQ2()` with that interpretation + descriptive context.
 *   4. Assert verdict + rule code match the scenario's expected outcome.
 *   5. Print a human-readable summary ("PROOF" block) suitable for sending
 *      to Samir as deliverable #3.
 *
 * Scenarios cover the four verdict universes Samir asked for:
 *   - STABLE  (calm market)
 *   - SHIFTED (validated market move)
 *   - UNCERTAIN (weak validation)
 *   - INSUFFICIENT_DATA (corpus too thin)
 * Plus an "early pattern" case that must NOT overreact (STABLE).
 *
 * Run:
 *   npx tsx server/pipeline/real-scenario-harness.ts
 *
 * Exit code is non-zero if any case fails its assertion.
 */
import { interpretCompetitorPosts } from "./lanes/competitor/interpret";
import type { CompetitorPost } from "./lanes/competitor/types";
import {
  decideQ2,
  type Q2CompetitorSnapshot,
  type Q2DnaContext,
  type Q2UserContext,
} from "../boss/policy/market-shift";
import type { Q2Verdict } from "../boss/types";

interface Scenario {
  id: string;
  title: string;
  story: string;
  posts: CompetitorPost[];
  competitorSnapshot: Q2CompetitorSnapshot;
  user: Q2UserContext;
  dna: Q2DnaContext;
  expectVerdict: Q2Verdict;
  expectRuleCode: string;
}

const NOW = new Date("2026-04-24T10:00:00Z").toISOString();
const userTruth = (s: Q2UserContext["truthStatus"]): Q2UserContext => ({
  truthStatus: s,
  rhythmStatus: "compliant",
  evaluationStatus: "complete",
});
const dnaActive: Q2DnaContext = {
  hasActiveDna: true,
  clusterComparisonVerdict: "stable",
  outcomeRegressed: false,
};
const dnaNone: Q2DnaContext = {
  hasActiveDna: false,
  clusterComparisonVerdict: null,
  outcomeRegressed: null,
};

const scenarios: Scenario[] = [
  // ────────────────────────────────────────────────────────────────────
  // S1 — Stable market. Three competitors active on IG, no shared themes.
  // ────────────────────────────────────────────────────────────────────
  {
    id: "S1",
    title: "Stable market — diverse competitors, no shared themes",
    story:
      "Three competitors are active on Instagram this week, but each is talking about a different angle. " +
      "Nothing is being repeated by more than one player. Market is calm.",
    posts: [
      { competitorId: "fitstudio_a", channel: "instagram", themeTokens: ["circuit_training"], observedAt: NOW },
      { competitorId: "fitstudio_a", channel: "instagram", themeTokens: ["circuit_training"], observedAt: NOW },
      { competitorId: "fitstudio_b", channel: "instagram", themeTokens: ["mobility_drills"], observedAt: NOW },
      { competitorId: "fitstudio_c", channel: "instagram", themeTokens: ["nutrition_coaching"], observedAt: NOW },
    ],
    competitorSnapshot: { recentRunsCount: 3, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaActive,
    expectVerdict: "STABLE",
    // Falls through to R-rules; truth submitted + nothing competitor-side -> quiet market.
    expectRuleCode: "rule:stable_quiet_market",
  },

  // ────────────────────────────────────────────────────────────────────
  // S2 — Validated shift. Four competitors converging on "value_offer"
  //      on IG, TikTok confirms with strong presence.
  // ────────────────────────────────────────────────────────────────────
  {
    id: "S2",
    title: "Validated shift — value-led offer landing on both channels",
    story:
      "Four direct competitors moved to value-led offers on Instagram in the last 7 days. " +
      "TikTok shows the same value-offer angle with strong engagement (multiple competitors, multiple posts). " +
      "This is a real, validated market move.",
    posts: [
      { competitorId: "studio_a", channel: "instagram", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_b", channel: "instagram", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_c", channel: "instagram", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_d", channel: "instagram", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_a", channel: "tiktok", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_a", channel: "tiktok", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_b", channel: "tiktok", themeTokens: ["value_offer"], observedAt: NOW },
      { competitorId: "studio_c", channel: "tiktok", themeTokens: ["value_offer"], observedAt: NOW },
    ],
    competitorSnapshot: { recentRunsCount: 8, signalCount: 8, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaActive,
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_pattern_validated",
  },

  // ────────────────────────────────────────────────────────────────────
  // S3 — Weak validation. Three IG competitors share "fasterresults",
  //      TikTok has only one mention -> weak.
  // ────────────────────────────────────────────────────────────────────
  {
    id: "S3",
    title: "Weak validation — IG pattern, only one competitor on TikTok",
    story:
      "Three competitors are pushing 'fasterresults' on Instagram, which forms a real IG pattern. " +
      "But TikTok has only one of those competitors echoing it once — too thin to call validated.",
    posts: [
      { competitorId: "gym_x", channel: "instagram", themeTokens: ["fasterresults"], observedAt: NOW },
      { competitorId: "gym_y", channel: "instagram", themeTokens: ["fasterresults"], observedAt: NOW },
      { competitorId: "gym_z", channel: "instagram", themeTokens: ["fasterresults"], observedAt: NOW },
      { competitorId: "gym_y", channel: "tiktok", themeTokens: ["fasterresults"], observedAt: NOW },
    ],
    competitorSnapshot: { recentRunsCount: 4, signalCount: 4, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaActive,
    expectVerdict: "UNCERTAIN",
    expectRuleCode: "rule:uncertain_weak_validation",
  },

  // ────────────────────────────────────────────────────────────────────
  // S4 — Insufficient data. Only one competitor producing posts.
  // ────────────────────────────────────────────────────────────────────
  {
    id: "S4",
    title: "Insufficient data — single competitor, no defensible pattern claim",
    story:
      "Only one competitor has posts in the lookback window. " +
      "By doctrine, a single competitor cannot produce a 'market pattern' claim.",
    posts: [
      { competitorId: "solo_competitor", channel: "instagram", themeTokens: ["urgency"], observedAt: NOW },
      { competitorId: "solo_competitor", channel: "instagram", themeTokens: ["urgency"], observedAt: NOW },
      { competitorId: "solo_competitor", channel: "tiktok", themeTokens: ["urgency"], observedAt: NOW },
    ],
    competitorSnapshot: { recentRunsCount: 1, signalCount: 2, changeEvents: { major: 0, medium: 0, mild: 1 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "INSUFFICIENT_DATA",
    expectRuleCode: "rule:insufficient_corpus_too_few_competitors",
  },

  // ────────────────────────────────────────────────────────────────────
  // S5 — Early pattern. Two IG competitors share a theme, no TikTok.
  //      System must NOT overreact — STABLE per Samir doctrine.
  // ────────────────────────────────────────────────────────────────────
  {
    id: "S5",
    title: "Early pattern — IG-only signal, do NOT overreact",
    story:
      "Two competitors started using 'morning_routine' on Instagram this week. " +
      "It clears the multi-competitor IG threshold, but TikTok shows zero validation. " +
      "System should flag the pattern but stay STABLE — early signals are not market shifts.",
    posts: [
      { competitorId: "wellness_a", channel: "instagram", themeTokens: ["morning_routine"], observedAt: NOW },
      { competitorId: "wellness_b", channel: "instagram", themeTokens: ["morning_routine"], observedAt: NOW },
      // Some unrelated TikTok activity — proves TikTok presence on other themes
      // doesn't accidentally validate this one.
      { competitorId: "wellness_c", channel: "tiktok", themeTokens: ["different_topic"], observedAt: NOW },
    ],
    competitorSnapshot: { recentRunsCount: 3, signalCount: 2, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaActive,
    expectVerdict: "STABLE",
    expectRuleCode: "rule:stable_pattern_detected_no_validation",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

console.log("");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log(" Phase 7.5 — Q2 real-scenario validation harness");
console.log("═══════════════════════════════════════════════════════════════════════════");

for (const sc of scenarios) {
  console.log("");
  console.log(`── ${sc.id}: ${sc.title}`);
  console.log(`   STORY:    ${sc.story}`);

  const interpretation = interpretCompetitorPosts(sc.posts);
  console.log(
    `   CORPUS:   distinctCompetitors=${interpretation.totals.distinctCompetitors} ` +
      `ig=${interpretation.totals.distinctIgCompetitors}/${interpretation.totals.igPostCount}p ` +
      `tt=${interpretation.totals.distinctTiktokCompetitors}/${interpretation.totals.tiktokPostCount}p ` +
      `status=${interpretation.corpusStatus}`,
  );
  if (interpretation.signals.length) {
    for (const s of interpretation.signals) {
      console.log(
        `   SIGNAL:   ${s.themeToken}  status=${s.status}  ` +
          `ig=${s.igCompetitorIds.length}c/${s.igPostCount}p  ` +
          `tt=${s.tiktokCompetitorIds.length}c/${s.tiktokPostCount}p`,
      );
    }
  } else {
    console.log("   SIGNAL:   (none)");
  }
  if (interpretation.diagnostics.length) {
    for (const d of interpretation.diagnostics) {
      console.log(`   DIAG:     ${d.themeToken}  status=${d.status}`);
    }
  }

  const decision = decideQ2(sc.competitorSnapshot, sc.user, sc.dna, interpretation);
  console.log(`   DECISION: verdict=${decision.verdict}  rule=${decision.ruleCode}`);
  console.log(`   REASON:   ${decision.ruleReason}`);

  const ok = decision.verdict === sc.expectVerdict && decision.ruleCode === sc.expectRuleCode;
  if (ok) {
    passed++;
    console.log(`   RESULT:   ✓ PASS  (expected verdict=${sc.expectVerdict} rule=${sc.expectRuleCode})`);
  } else {
    failed++;
    const detail =
      `expected verdict=${sc.expectVerdict} rule=${sc.expectRuleCode}, ` +
      `got verdict=${decision.verdict} rule=${decision.ruleCode}`;
    failures.push(`${sc.id}: ${sc.title}\n    ${detail}`);
    console.error(`   RESULT:   ✗ FAIL  ${detail}`);
  }
}

console.log("");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log(` real-scenario harness — ${passed}/${scenarios.length} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════════════════════");

if (failed > 0) {
  console.error("");
  console.error("FAILURES:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
process.exit(0);
