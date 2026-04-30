/**
 * Phase 7.4 — Q2 verdict harness.
 *
 * Locked by Samir 2026-04-24: every verdict in the new 4-verdict universe
 * (STABLE / SHIFTED / UNCERTAIN / INSUFFICIENT_DATA) must have a
 * deterministic, reproducible test case. This harness exercises the pure
 * `decideQ2()` decision tree across the rule grid and asserts the verdict +
 * rule code that fires.
 *
 * Run:
 *   npx tsx server/boss/policy/q2-verdict-harness.ts
 *
 * Exit code is non-zero if any case fails.
 */
import {
  decideQ2,
  type Q2CompetitorSnapshot,
  type Q2DnaContext,
  type Q2UserContext,
} from "./market-shift";
import type { CompetitorInterpretation, CompetitorThemeSignal } from "../../pipeline/lanes/competitor/interpret";
import type { Q2Verdict } from "../types";

interface Case {
  name: string;
  competitor: Q2CompetitorSnapshot;
  user: Q2UserContext;
  dna: Q2DnaContext;
  /** Phase 7.5 — when present, decideQ2 takes the I-rule path. */
  interpretation?: CompetitorInterpretation;
  expectVerdict: Q2Verdict;
  expectRuleCode: string;
}

function sig(themeToken: string, status: CompetitorThemeSignal["status"]): CompetitorThemeSignal {
  return {
    themeToken,
    status,
    igCompetitorIds: ["c1", "c2"],
    igPostCount: 4,
    tiktokCompetitorIds: status === "pattern_validated" ? ["c1", "c2"] : status === "weak_validation" ? ["c1"] : [],
    tiktokPostCount: status === "pattern_validated" ? 5 : status === "weak_validation" ? 1 : 0,
    reason: `${status}:harness`,
  };
}

function interp(opts: {
  corpusStatus?: "ok" | "insufficient_data";
  corpusReason?: string;
  signals?: CompetitorThemeSignal[];
  diagnostics?: CompetitorThemeSignal[];
  competitors?: number;
  igPosts?: number;
  tiktokPosts?: number;
}): CompetitorInterpretation {
  return {
    corpusStatus: opts.corpusStatus ?? "ok",
    corpusReason: opts.corpusReason ?? "ok",
    totals: {
      distinctCompetitors: opts.competitors ?? 3,
      distinctIgCompetitors: opts.competitors ?? 3,
      distinctTiktokCompetitors: opts.competitors ?? 2,
      igPostCount: opts.igPosts ?? 12,
      tiktokPostCount: opts.tiktokPosts ?? 8,
    },
    signals: opts.signals ?? [],
    diagnostics: opts.diagnostics ?? [],
  };
}

const userTruth = (s: Q2UserContext["truthStatus"]): Q2UserContext => ({
  truthStatus: s,
  rhythmStatus: null,
  evaluationStatus: null,
});

const dnaNone: Q2DnaContext = {
  hasActiveDna: false,
  clusterComparisonVerdict: null,
  outcomeRegressed: null,
};

const cases: Case[] = [
  {
    name: "R0: zero competitor runs -> INSUFFICIENT_DATA",
    competitor: { recentRunsCount: 0, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth(null),
    dna: dnaNone,
    expectVerdict: "INSUFFICIENT_DATA",
    expectRuleCode: "rule:insufficient_no_competitor_runs",
  },
  {
    name: "R1: runs exist but no signals + no truth -> INSUFFICIENT_DATA",
    competitor: { recentRunsCount: 3, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("missing"),
    dna: dnaNone,
    expectVerdict: "INSUFFICIENT_DATA",
    expectRuleCode: "rule:insufficient_no_market_signal",
  },
  {
    name: "R2a: one major change -> SHIFTED",
    competitor: { recentRunsCount: 5, signalCount: 4, changeEvents: { major: 1, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_major>=1",
  },
  {
    name: "R2b: three medium changes (no major) -> SHIFTED",
    competitor: { recentRunsCount: 5, signalCount: 6, changeEvents: { major: 0, medium: 3, mild: 1 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_medium>=3",
  },
  {
    name: "R3: one medium, no major -> UNCERTAIN",
    competitor: { recentRunsCount: 5, signalCount: 3, changeEvents: { major: 0, medium: 1, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "UNCERTAIN",
    expectRuleCode: "rule:uncertain_medium",
  },
  {
    name: "R3: two medium, no major -> still UNCERTAIN (under SHIFTED threshold)",
    competitor: { recentRunsCount: 5, signalCount: 3, changeEvents: { major: 0, medium: 2, mild: 5 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "UNCERTAIN",
    expectRuleCode: "rule:uncertain_medium",
  },
  {
    name: "R4: only mild + signals (early patterns) -> STABLE (do not overreact)",
    competitor: { recentRunsCount: 4, signalCount: 8, changeEvents: { major: 0, medium: 0, mild: 3 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "STABLE",
    expectRuleCode: "rule:stable_early_patterns_only",
  },
  {
    name: "R4: only signals (pattern_detected proxy) -> STABLE",
    competitor: { recentRunsCount: 2, signalCount: 4, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "STABLE",
    expectRuleCode: "rule:stable_early_patterns_only",
  },
  {
    name: "R5: nothing competitor-side but truth submitted -> STABLE quiet market",
    competitor: { recentRunsCount: 1, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    expectVerdict: "STABLE",
    expectRuleCode: "rule:stable_quiet_market",
  },
  // Cardinal rule: descriptive context (user/DNA) must NOT change verdict.
  {
    name: "isolation: same competitor signal, varying DNA — verdict identical",
    competitor: { recentRunsCount: 5, signalCount: 4, changeEvents: { major: 1, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: { hasActiveDna: true, clusterComparisonVerdict: "drift_detected", outcomeRegressed: true },
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_major>=1",
  },

  // ──────────────────────────────────────────────────────────────────
  // Phase 7.5 — I-rule cases (interpretation-driven, real Phase 7.3)
  // ──────────────────────────────────────────────────────────────────
  {
    name: "I0: corpus insufficient_data -> INSUFFICIENT_DATA (overrides severity buckets)",
    competitor: { recentRunsCount: 5, signalCount: 4, changeEvents: { major: 1, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({
      corpusStatus: "insufficient_data",
      corpusReason: "insufficient_data:competitors<2",
      competitors: 1,
      igPosts: 3,
      tiktokPosts: 0,
    }),
    expectVerdict: "INSUFFICIENT_DATA",
    expectRuleCode: "rule:insufficient_corpus_too_few_competitors",
  },
  {
    name: "I1: pattern_validated signal -> SHIFTED (overrides empty severity)",
    competitor: { recentRunsCount: 4, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({ signals: [sig("value_offer", "pattern_validated")] }),
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_pattern_validated",
  },
  {
    name: "I2: weak_validation only -> UNCERTAIN",
    competitor: { recentRunsCount: 3, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({ signals: [sig("hookstyle", "weak_validation")] }),
    expectVerdict: "UNCERTAIN",
    expectRuleCode: "rule:uncertain_weak_validation",
  },
  {
    name: "I3: pattern_detected only (no TikTok validation) -> STABLE (do not overreact)",
    competitor: { recentRunsCount: 3, signalCount: 2, changeEvents: { major: 0, medium: 0, mild: 1 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({ signals: [sig("urgency", "pattern_detected")] }),
    expectVerdict: "STABLE",
    expectRuleCode: "rule:stable_pattern_detected_no_validation",
  },
  {
    name: "I-priority: validated wins over weak (mixed signals -> SHIFTED)",
    competitor: { recentRunsCount: 5, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({
      signals: [sig("hookstyle", "weak_validation"), sig("value_offer", "pattern_validated")],
    }),
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_pattern_validated",
  },
  {
    name: "I-fallthrough: only diagnostics -> falls back to R-rules (severity present -> SHIFTED)",
    competitor: { recentRunsCount: 5, signalCount: 4, changeEvents: { major: 1, medium: 0, mild: 0 } },
    user: userTruth("submitted"),
    dna: dnaNone,
    interpretation: interp({
      signals: [],
      diagnostics: [sig("tiktok_only_theme", "tiktok_only")],
    }),
    expectVerdict: "SHIFTED",
    expectRuleCode: "rule:shifted_major>=1",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  const r = decideQ2(c.competitor, c.user, c.dna, c.interpretation);
  const ok = r.verdict === c.expectVerdict && r.ruleCode === c.expectRuleCode;
  if (ok) {
    passed++;
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    const detail = `expected verdict=${c.expectVerdict} rule=${c.expectRuleCode}, got verdict=${r.verdict} rule=${r.ruleCode}`;
    failures.push(`✗ ${c.name}\n    ${detail}`);
    console.error(`  ✗ ${c.name}`);
    console.error(`    ${detail}`);
  }
}

console.log("");
console.log(`Q2 verdict harness — ${passed}/${cases.length} passed, ${failed} failed`);

if (failed > 0) {
  console.error("");
  console.error("FAILURES:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
process.exit(0);
