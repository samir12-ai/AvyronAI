/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Seal Regression Tripwires — W5 doctrine layer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Purpose
 *   Make "false-green" seals structurally hard to reach. Each tripwire below
 *   detects ONE class of regression that previously slipped past architect
 *   review or manual audit.
 *
 *   When any tripwire fires, the message names the doctrine rule and the
 *   companion rationale lives in `.local/plans/seal-regression-tripwires.md`.
 *
 * Tripwires
 *   T-A  Silent substitution     — `requireCampaign` must explicitly reject
 *                                  foreign campaignIds, never fall through to
 *                                  "load most-recent for account".
 *   T-B  Denial-body leakage     — Ownership-error handler must NOT echo
 *                                  attacker-supplied identifiers.
 *   T-C  403/404 ownership drift — All ownership denials must use 404
 *                                  CAMPAIGN_NOT_FOUND (anti-enumeration).
 *                                  No surviving 403 CAMPAIGN_NOT_OWNED.
 *   T-D  Raw-SQL ownership drift — No new raw `selected_campaign_id ...
 *                                  account_id` SQL ownership probes outside
 *                                  the centralized `assertCampaignBelongsTo`
 *                                  helper. (Migrated paths grandfather to
 *                                  the helper.)
 *   T-E  Scoped-query-without-explicit-assert — Files reading body/query/
 *                                  params campaignId must contain ONE of
 *                                  `assertCampaignBelongsTo`, `requireCampaign`,
 *                                  or be in a documented exemption manifest
 *                                  with rationale.
 *   T-F  Confidence floor inflation — `?? 0.5` and `?? 0.3` defaults are
 *                                  forbidden in engine outputs (P0-5 doctrine
 *                                  — zero evidence must produce 0 confidence).
 *   T-G  Fake-PASS fallthrough   — Recovery / system-control modules MUST
 *                                  NOT default to `verdict: "PASS"` /
 *                                  `status: "PASS"` on missing/unknown input.
 *   T-H  Latest-without-scope    — `orderBy(desc(...))` followed by
 *                                  `.limit(1)` against snapshot/plan/job
 *                                  tables must include an account or
 *                                  campaign filter in the same .where().
 *
 * Each tripwire is a static source-pattern test. Failures appear at CI time
 * the moment a developer reintroduces the forbidden pattern.
 *
 * IMPORTANT: tripwires are deliberately strict and may flag intentional
 * code. The fix path is ALWAYS one of:
 *   (a) Refactor to satisfy the rule.
 *   (b) Add an explicit, documented entry to the exemption list in this file
 *       AND in `.local/plans/seal-regression-tripwires.md` with rationale.
 * Silently weakening the regex to make a test pass is a doctrine violation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const SERVER = path.join(ROOT, "server");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip tests, generated, and vendored dirs.
      if (["tests", "node_modules", "dist", "build"].includes(entry)) continue;
      walk(full, out);
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const ALL_SERVER_TS = walk(SERVER);
const rel = (abs: string) => path.relative(ROOT, abs).replace(/\\/g, "/");

// ─────────────────────────────────────────────────────────────────────────────
// T-A — Silent substitution (the original W0-T1 failure mode)
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-A — silent substitution in requireCampaign", () => {
  const src = read("server/campaign-routes.ts");

  it("when requestedCampaignId is supplied and ownership query returns 0 rows, middleware MUST short-circuit (return) — never fall through", () => {
    // Locate the requested-campaign branch and prove a `return` precedes the
    // closing of the `if (selections.length === 0)` block. Using a permissive
    // multi-line slice so future formatting tweaks don't break it.
    const branchStart = src.indexOf("if (requestedCampaignId)");
    expect(branchStart).toBeGreaterThan(-1);
    const branchSlice = src.slice(branchStart, branchStart + 4000);
    expect(branchSlice).toMatch(
      /if\s*\(\s*selections\.length\s*===\s*0\s*\)\s*\{[\s\S]{1,800}?return\s+res\.status/,
    );
  });

  it("the convenience 'most-recent' fallback (orderBy desc selectedAt) inside requireCampaign appears ONLY in an `else` branch", () => {
    // Anchor the search to the requireCampaign function body — the file
    // contains other functions that legitimately use orderBy desc selectedAt
    // for non-ownership purposes. Slice from the function declaration to a
    // generous upper bound so future formatting tweaks don't drift the test.
    const fnStart = src.indexOf("export async function requireCampaign(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnSlice = src.slice(fnStart, fnStart + 6000);
    const fallbackIdx = fnSlice.indexOf("orderBy(desc(campaignSelections.selectedAt))");
    expect(fallbackIdx).toBeGreaterThan(-1);
    const elseIdx = fnSlice.lastIndexOf("} else {", fallbackIdx);
    expect(elseIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeLessThan(fallbackIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-B — Denial-body leakage (handleOwnershipError surface)
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-B — ownership-denial responses do not echo attacker input", () => {
  const src = read("server/auth-helpers.ts");

  it("handleOwnershipError JSON body MUST NOT include `accountId` or `campaignId` template substitution", () => {
    const fnStart = src.indexOf("export function handleOwnershipError");
    expect(fnStart).toBeGreaterThan(-1);
    const fnSlice = src.slice(fnStart, fnStart + 1500);
    // No `${...accountId}` / `${...campaignId}` interpolation in the response.
    expect(fnSlice).not.toMatch(/\$\{[^}]*accountId[^}]*\}/);
    expect(fnSlice).not.toMatch(/\$\{[^}]*campaignId[^}]*\}/);
    // No bare `accountId:` or `campaignId:` JSON keys in the response payload.
    // (We allow the comment block above the function — only check the body.)
    const bodySlice = fnSlice.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(bodySlice).not.toMatch(/\bjson\(\s*\{[^}]*\baccountId\s*:/);
    expect(bodySlice).not.toMatch(/\bjson\(\s*\{[^}]*\bcampaignId\s*:/);
  });

  it("Error class messages may include identifiers internally, but `code` field is the attacker-visible surface", () => {
    expect(src).toContain('code = "CAMPAIGN_NOT_FOUND"');
    expect(src).toContain('code = "JOB_NOT_FOUND"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-C — 403/404 ownership-semantics drift
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-C — ownership denials normalized to 404 CAMPAIGN_NOT_FOUND", () => {
  // Exemptions: NONE. The legacy 403 CAMPAIGN_NOT_OWNED was retired by W5.
  // If a future code path needs a different status, add it here with rationale.
  const EXEMPT_403_NOT_OWNED: string[] = [];

  it("no production server file uses the legacy `CAMPAIGN_NOT_OWNED` denial code", () => {
    const offenders: string[] = [];
    for (const abs of ALL_SERVER_TS) {
      const r = rel(abs);
      if (EXEMPT_403_NOT_OWNED.includes(r)) continue;
      const src = readFileSync(abs, "utf-8");
      // Match only the response-code shape, not stray comments mentioning it.
      if (/code\s*:\s*"CAMPAIGN_NOT_OWNED"/.test(src)) {
        offenders.push(r);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no production server file returns 403 alongside an ownership/auth denial code", () => {
    const offenders: string[] = [];
    for (const abs of ALL_SERVER_TS) {
      const src = readFileSync(abs, "utf-8");
      // Pattern: res.status(403).json({ code: "...NOT_OWNED..." | "...NOT_FOUND..." | "...FORBIDDEN_CAMPAIGN..." })
      if (/res\.status\(403\)\.json\(\s*\{[^}]*code\s*:\s*"[^"]*(?:NOT_OWNED|NOT_FOUND_CAMPAIGN|FORBIDDEN_CAMPAIGN)[^"]*"/.test(src)) {
        offenders.push(rel(abs));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-D — Raw-SQL ownership drift
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-D — no new raw-SQL ownership probes outside the helper", () => {
  // Exemption manifest. Each entry MUST cite the file and the reason.
  // The helper itself naturally contains the canonical query — exempt.
  const EXEMPT_RAW_SQL_OWNERSHIP: Array<{ file: string; reason: string }> = [
    { file: "server/auth-helpers.ts", reason: "Defines the canonical ownership helper itself." },
    // Worker / scheduled-job paths that resolve campaignId outside an HTTP
    // request lifecycle and validate via accountId-scoped queries elsewhere
    // can be added here with explicit rationale.
  ];
  const exemptSet = new Set(EXEMPT_RAW_SQL_OWNERSHIP.map(e => e.file));

  it("no production server file outside the exemption list contains the raw `SELECT selected_campaign_id ... account_id` ownership shape", () => {
    const offenders: string[] = [];
    for (const abs of ALL_SERVER_TS) {
      const r = rel(abs);
      if (exemptSet.has(r)) continue;
      const src = readFileSync(abs, "utf-8");
      // Detect the raw-SQL ownership shape (template-literal SQL with both
      // selected_campaign_id and account_id columns referenced near each other).
      // Window is intentionally tight (240 chars) to reduce false positives.
      if (/selected_campaign_id[\s\S]{0,240}account_id|account_id[\s\S]{0,240}selected_campaign_id/.test(src)) {
        offenders.push(r);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-E — Scoped-query-without-explicit-assert
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-E — campaignId-reading routes have nearby ownership proof", () => {
  // Exemption manifest. Files where ownership is enforced indirectly (via
  // mounted middleware in routes.ts, or via accountId-scoped data layer)
  // are listed here with rationale. Keep this list MINIMAL.
  const EXEMPT_E: Array<{ file: string; reason: string }> = [
    { file: "server/campaign-routes.ts", reason: "Defines requireCampaign itself; reads campaignId to seed ownership query." },
    { file: "server/root-bundle.ts", reason: "Pure data-layer helpers; called only with accountId+campaignId pre-validated by callers." },
    { file: "server/plan-gate.ts", reason: "Pure validator; receives pre-validated campaignId from gate-call sites." },
    { file: "server/task-composer.ts", reason: "WHERE accountId AND campaignId on every read/write; no ambient ownership." },
    { file: "server/data-source/routes.ts", reason: "All routes mounted under requireCampaign; campaignId from req.body matches campaignContext." },
    { file: "server/strategy-root-routes.ts", reason: "Mounted under requireCampaign middleware in server/index.ts." },
    { file: "server/strategic-core/orchestrator-routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategic-core/execution-routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/awareness-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/build-plan-layer/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/differentiation-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/funnel-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/integrity-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/mechanism-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/offer-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/persuasion-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/positioning-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategy/budget-governor/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategy/channel-selection/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategy/iteration-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategy/retention-engine/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/strategy/statistical-validation/routes.ts", reason: "Mounted under requireCampaign; campaignContext supplies validated id." },
    { file: "server/competitive-intelligence/data-acquisition-routes.ts", reason: "Account-scoped via accountId on every persistent write; campaignId is body-supplied for keying only." },
  ];
  const exemptSet = new Set(EXEMPT_E.map(e => e.file));

  it("every server file reading body/params/query.campaignId either calls assertCampaignBelongsTo, mounts requireCampaign, or is in the exemption manifest", () => {
    const offenders: string[] = [];
    for (const abs of ALL_SERVER_TS) {
      const r = rel(abs);
      const src = readFileSync(abs, "utf-8");
      const reads =
        /req\.(?:body|params|query)\.campaignId/.test(src) ||
        /req\.(?:body|params|query)\?\.campaignId/.test(src);
      if (!reads) continue;
      if (exemptSet.has(r)) continue;
      const hasAssert = /\bassertCampaignBelongsTo\b/.test(src);
      const hasMiddlewareMount = /\brequireCampaign\b/.test(src);
      if (!hasAssert && !hasMiddlewareMount) {
        offenders.push(r);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Files exempted from PROXIMITY CHECK with rationale (separate from EXEMPT_E
   // which covers T-E direct-token presence). PROXIMITY scope is stricter so
   // its exemption set is disjoint and explicitly justified.
  const EXEMPT_PROXIMITY: Array<{ file: string; reason: string }> = [
    {
      file: "server/pipeline/routes.ts",
      // Entire pipeline router is gated by `router.use(authMiddleware); router.use(adminMiddleware);`
      // (lines 33-34). All 30+ destructuring reads are inside admin-only
      // operational endpoints where admins legitimately operate cross-campaign
      // (provisioning runs, viewing rejections, managing DNA). Cross-tenant
      // leakage is bounded by adminMiddleware. NOT a doctrine bypass — the
      // gating is at a different layer (RBAC, not multi-tenancy boundary).
      reason: "Entire router gated by adminMiddleware; cross-campaign ops are intentional admin behavior.",
    },
  ];
  const exemptProxSet = new Set(EXEMPT_PROXIMITY.map((e) => e.file));

  it("PROXIMITY CHECK — every req.body/params/query.campaignId read (direct OR destructured) has an ownership proof within the SAME express handler block", () => {
    // Hardened in response to architect review #8. Three findings fixed:
    //   F1: destructuring (`const { campaignId } = req.body`) was invisible to
    //       the previous detector. Now matched as a first-class read.
    //   F2: handler-block split only recognized `app.<verb>(`. Router-centric
    //       files (router.get/post/use/...) collapsed into one giant block.
    //       Boundaries now also include `router.<verb>(`.
    //   F3: comment-stripping regex was fragile vs `//` inside string/regex
    //       literals. Replaced with a stricter line-comment matcher that
    //       requires whitespace or line-start before `//` and is bounded to
    //       a single line. Block comments unchanged (already safe per spec).
    //
    // Hardened in response to architect review #7. Three findings fixed:
    //   F1: 6000-char window leaked across handler boundaries — now
    //       proximity is computed per-handler-block (boundaries = handler decls).
    //   F2: hasInlineDbScope was satisfied by tokens anywhere in the window,
    //       including comments. Now we strip line + block comments first.
    //   F3: req.query.campaignId was excluded from coverage. Now included.
    //
    // Acceptable proofs within the SAME handler block:
    //   - assertCampaignBelongsTo(<accountId>, ...)             — explicit assert
    //   - req.campaignContext.campaignId                        — middleware-validated id
    //   - eq(<table>.campaignId, <read>) AND eq(<table>.accountId, accountId) — inline DB-WHERE tenant scope
    //   - campaignId as a typed function parameter              — worker/helper context

    /**
     * Strip TS comments so commented code cannot satisfy proofs.
     * Stricter than prior cycle: line-comment matcher requires whitespace or
     * line-start immediately before `//`, which prevents false-stripping of
     * `//` sequences inside string literals (e.g., `"http://..."`) and regex
     * literals. This is still a regex approximation — not a full TS lexer —
     * but the false-positive surface is sharply reduced. Documented as a
     * known parser-integrity limit in §9.8 of the seal doc.
     */
    const stripComments = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
        .replace(/(^|[\s;{}()])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

    /**
     * Split source into handler-scoped blocks. A "block" here = the substring
     * starting at one `app.<verb>(` declaration and ending just before the
     * next one (or EOF). This gives a per-handler scope that is robust to
     * arbitrarily long handler bodies and prevents cross-handler leakage.
     */
    interface Block { start: number; end: number; }
    const splitHandlerBlocks = (src: string): Block[] => {
      // Boundaries now include both top-level Express app and router decls
      // (architect-#8 F2). Covers `app.<verb>(`, `router.<verb>(`, and
      // `<varname>.<verb>(` for arbitrary router variable names commonly
      // used in this codebase (e.g., `competitorRouter.get`).
      const RE = /\b(?:app|router|\w*[Rr]outer)\.(?:get|post|put|delete|patch|use)\s*\(/g;
      const starts: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = RE.exec(src)) !== null) starts.push(m.index);
      if (starts.length === 0) return [{ start: 0, end: src.length }];
      const blocks: Block[] = [];
      if (starts[0] > 0) blocks.push({ start: 0, end: starts[0] });
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1] : src.length;
        blocks.push({ start, end });
      }
      return blocks;
    };

    const offenders: Array<{ file: string; line: number; kind: string; snippet: string }> = [];
    // Direct read: req.body.campaignId / req.params.campaignId / req.query.campaignId
    const RE_READ_DIRECT = /req\.(?:body|params|query)\??\.campaignId/g;
    // Destructured read: const { ... campaignId ... } = req.body|params|query
    // (architect-#8 F1). Single-line patterns; multiline destructuring is rare
    // for this field but is also flagged by the multiline variant below.
    const RE_READ_DESTRUCT =
      /\b(?:const|let|var)\s*\{[^}]*\bcampaignId\b[^}]*\}\s*=\s*req\.(?:body|params|query)\b/g;

    for (const abs of ALL_SERVER_TS) {
      const r = rel(abs);
      if (exemptSet.has(r)) continue;
      if (exemptProxSet.has(r)) continue;
      const rawSrc = readFileSync(abs, "utf-8");
      const src = stripComments(rawSrc);
      const blocks = splitHandlerBlocks(src);

      const checkBlock = (idx: number, kind: string) => {
        const block = blocks.find((b) => idx >= b.start && idx < b.end);
        if (!block) return;
        const blockText = src.slice(block.start, block.end);
        const hasAssert = /\bassertCampaignBelongsTo\s*\(/.test(blockText);
        const hasContext = /\breq\.campaignContext\b/.test(blockText);
        const hasInlineDbScope =
          /\beq\(\s*\w+\.campaignId\s*,/.test(blockText) &&
          /\beq\(\s*\w+\.accountId\s*,\s*accountId\s*\)/.test(blockText);
        const isFunctionParam =
          /\b(?:function\s+\w+|async\s+function\s+\w+|const\s+\w+\s*=\s*async)\s*\([^)]*campaignId\s*[:,)][^)]*\)/.test(blockText);
        if (!hasAssert && !hasContext && !hasInlineDbScope && !isFunctionParam) {
          const line = rawSrc.slice(0, idx).split("\n").length;
          offenders.push({ file: r, line, kind, snippet: rawSrc.slice(Math.max(0, idx - 40), idx + 60).replace(/\s+/g, " ") });
        }
      };

      let m: RegExpExecArray | null;
      while ((m = RE_READ_DIRECT.exec(src)) !== null) checkBlock(m.index, "direct");
      while ((m = RE_READ_DESTRUCT.exec(src)) !== null) checkBlock(m.index, "destructured");
    }
    expect(offenders).toEqual([]);
  });

  it("every exemption entry still references an existing file (manifest hygiene)", () => {
    for (const { file } of EXEMPT_E) {
      expect(() => readFileSync(path.join(ROOT, file), "utf-8")).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-F — Confidence floor inflation (P0-5 doctrine)
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-F — no hardcoded confidence floors in engine outputs", () => {
  // Files where an explicit `?? 0.5` is intentional (e.g., default for a
  // *display* preference, not a confidence/score). MUST cite reason.
  const EXEMPT_F: Array<{ file: string; reason: string }> = [];
  const exemptSet = new Set(EXEMPT_F.map(e => e.file));

  it("no engine file uses `?? 0.5` or `?? 0.3` on a confidence/score expression", () => {
    const offenders: Array<{ file: string; sample: string }> = [];
    const ENGINE_DIRS = [
      "server/audience-engine",
      "server/awareness-engine",
      "server/offer-engine",
      "server/positioning-engine",
      "server/persuasion-engine",
      "server/strategy/statistical-validation",
    ];
    for (const dir of ENGINE_DIRS) {
      const abs = path.join(ROOT, dir);
      try { statSync(abs); } catch { continue; }
      for (const file of walk(abs)) {
        const r = rel(file);
        if (exemptSet.has(r)) continue;
        const src = readFileSync(file, "utf-8");
        // Pattern: `<confidence|score|weight|strength>... ?? 0.5` or `?? 0.3`
        const re = /(?:confidence|score|weight|strength)[^=\n;]{0,80}\?\?\s*0\.[35]\b/gi;
        const m = src.match(re);
        if (m && m.length) offenders.push({ file: r, sample: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-G — Fake-PASS fallthrough in recovery / system-control
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-G — recovery/system-control never default to verdict PASS", () => {
  it("no `?? \"PASS\"` / `|| \"PASS\"` defaults on verdict/status/integrityVerdict in system-control or recovery", () => {
    const offenders: Array<{ file: string; sample: string }> = [];
    const TARGET_DIRS = ["server/system-control", "server/recovery", "server/recovery-map"];
    for (const dir of TARGET_DIRS) {
      const abs = path.join(ROOT, dir);
      try { statSync(abs); } catch { continue; }
      for (const file of walk(abs)) {
        const src = readFileSync(file, "utf-8");
        const re = /(?:verdict|status|integrityVerdict|executionStatus|validationState|outcome)[^=\n;]{0,80}(?:\?\?|\|\|)\s*['"]PASS['"]/gi;
        const m = src.match(re);
        if (m && m.length) offenders.push({ file: rel(file), sample: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-H — Latest-without-scope on snapshot/plan/job tables
// ─────────────────────────────────────────────────────────────────────────────
describe("Tripwire T-H — desc().limit(1) on snapshot/plan/job tables includes account or campaign filter", () => {
  // Exemptions for tenant-scoped reads that route through a foreign-key
  // pre-validated by a sibling account/campaign-scoped query in the same
  // request. Each entry MUST cite the foreign key + the upstream scoping
  // call site so a future audit can re-verify the chain.
  const EXEMPT_H: Array<{ file: string; reason: string }> = [
    {
      file: "server/dashboard-routes.ts",
      reason: "planApprovals lookup is keyed by planId (FK to strategicPlans.id). plan.id is itself loaded via the account/campaign-scoped strategicPlans query immediately above (server/dashboard-routes.ts:447-461 — `from(strategicPlans).where(and(eq(...campaignId,campaignId), eq(...accountId,accountId)))`), so the planApprovals SELECT inherits tenant scope through the FK. Explicit account/campaign filter on planApprovals would be redundant.",
    },
    {
      file: "server/pipeline/eval-windows.ts",
      reason: "planApprovals lookup (lines 73-78) is keyed by planId (FK to strategicPlans.id). plan.id is loaded one statement above (lines 64-73) by an explicit accountId+campaignId+status='APPROVED' WHERE clause — the W5 architect-review-#6 hardening of the strategicPlans query closed the prior FK-only weakness. planApprovals schema has no accountId column; the FK chain is now the strictly correct tenant boundary.",
    },
  ];
  const exemptSet = new Set(EXEMPT_H.map(e => e.file));

  it("scans server tree for unscoped 'latest' reads on tenant-bearing tables", () => {
    // We look for a `.from(<table>)...orderBy(desc(...))...limit(1)` window
    // that does NOT contain `accountId` or `campaignId` in the same window.
    const TENANT_TABLES = [
      "miSnapshots",
      "audienceSnapshots",
      "strategicPlans",
      "orchestratorJobs",
      "miFetchJobs",
      "planApprovals",
      "decisionOutcomes",
    ];
    const offenders: Array<{ file: string; table: string }> = [];
    for (const abs of ALL_SERVER_TS) {
      const r = rel(abs);
      if (exemptSet.has(r)) continue;
      const src = readFileSync(abs, "utf-8");
      for (const table of TENANT_TABLES) {
        // Match a window: .from(table) ... .limit(1)
        // (non-greedy, capped at 600 chars to keep windows local).
        const re = new RegExp(
          `\\.from\\(\\s*${table}\\s*\\)[\\s\\S]{0,600}?\\.limit\\(\\s*1\\s*\\)`,
          "g",
        );
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const window = m[0];
          // Must include desc() — this is what marks it as a "latest" read.
          if (!/\borderBy\(\s*desc\(/.test(window)) continue;
          // Must include accountId OR campaignId in the same window.
          if (/\baccountId\b|\bcampaignId\b/.test(window)) continue;
          offenders.push({ file: r, table });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
