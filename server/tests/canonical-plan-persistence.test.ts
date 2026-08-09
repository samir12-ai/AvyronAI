import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const schema = readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
const migration = readFileSync(
  path.join(ROOT, "server/migrations/sql/059_build_plan_snapshot_job_lineage.sql"),
  "utf8",
);
const buildPlanRoutes = readFileSync(path.join(ROOT, "server/build-plan-layer/routes.ts"), "utf8");
const orchestratorRoutes = readFileSync(path.join(ROOT, "server/orchestrator/routes.ts"), "utf8");
const realRunVerifier = readFileSync(path.join(ROOT, ".local/scripts/run-real-campaign.ts"), "utf8");
const buildThePlan = readFileSync(path.join(ROOT, "components/BuildThePlan.tsx"), "utf8");
const engineTable = readFileSync(path.join(ROOT, "components/EngineTableModal.tsx"), "utf8");
const executionPlan = readFileSync(path.join(ROOT, "components/ExecutionPlan.tsx"), "utf8");
const orchestratorPanel = readFileSync(path.join(ROOT, "components/OrchestratorPanel.tsx"), "utf8");

describe("canonical plan persistence", () => {
  it("stores build-plan results with the exact source job", () => {
    expect(schema).toMatch(/buildPlanSnapshots[\s\S]*jobId:\s*varchar\("job_id"\)\.notNull\(\)/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS job_id varchar/);
    expect(migration).toMatch(/build_plan_snapshots_run_idx/);
    expect(buildPlanRoutes).toMatch(/jobId:\s*sourceJobId/);
  });

  it("persists usable pass and review-required build plans but never BLOCK results", () => {
    const persistenceBranch = buildPlanRoutes.slice(
      buildPlanRoutes.indexOf('if (result.status === "SUCCESS" || result.status === "ACTIONABILITY_FAILED")'),
      buildPlanRoutes.indexOf("let narrative = null"),
    );
    expect(persistenceBranch).toContain('result.status === "SUCCESS"');
    expect(persistenceBranch).toContain('result.status === "ACTIONABILITY_FAILED"');
    expect(persistenceBranch).not.toContain('result.status === "BLOCKED"');
  });

  it("reads only the selected run's cached build plan and fails closed when absent", () => {
    const latestHandler = buildPlanRoutes.slice(
      buildPlanRoutes.indexOf('app.get("/api/build-plan-layer/latest"'),
      buildPlanRoutes.lastIndexOf("\n});"),
    );
    expect(latestHandler).toMatch(/resolveRunId\(campaignId, accountId, requestedJobId\)/);
    // The snapshot read is job-scoped via the shared fetch helper.
    expect(latestHandler).toMatch(/fetchStoredSnapshot\(accountId, campaignId, resolved\.runId\)/);
    expect(buildPlanRoutes).toMatch(/eq\(buildPlanSnapshots\.jobId, jobId\)/);
    expect(latestHandler).toContain('status: "CURRENT_RUN_PLAN_NOT_PERSISTED"');
    expect(latestHandler).not.toContain("generating fresh");
  });

  it("fails closed on unpinned reads when a newer non-resolvable run shadows the latest plan", () => {
    const latestHandler = buildPlanRoutes.slice(
      buildPlanRoutes.indexOf('app.get("/api/build-plan-layer/latest"'),
      buildPlanRoutes.lastIndexOf("\n});"),
    );
    // Task #171 — the stale-shadow guard must run BEFORE the current-run
    // snapshot read, and may only surface the older plan explicitly labeled
    // as previousPlan (never as `plan`), with shadowKind attached.
    const guardIdx = latestHandler.indexOf("resolved.isStale && !requestedJobId");
    const currentReadIdx = latestHandler.indexOf("fetchStoredSnapshot(accountId, campaignId, resolved.runId)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(currentReadIdx);
    expect(latestHandler).toContain("shadowedByRun");
    expect(latestHandler).toContain("shadowKind");
    expect(latestHandler).toMatch(/previousPlan:\s*previousSnapshot\?\.plan \?\? null/);
    // The shadow branch must never present the older plan as current.
    const shadowBranch = latestHandler.slice(guardIdx, currentReadIdx);
    expect(shadowBranch).toMatch(/plan:\s*null/);
  });

  it("ExecutionPlan carries run lineage and renders CURRENT_RUN_PLAN_NOT_PERSISTED customer-safe", () => {
    // Handles the fail-closed status on both the load and generate paths.
    expect(executionPlan.match(/CURRENT_RUN_PLAN_NOT_PERSISTED/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // Task #171 — the fail-closed state renders the previous plan ONLY when
    // the server explicitly labels it (previousPlan + shadowKind); otherwise
    // the plan is cleared. Never treats data.plan as current in this state.
    expect(executionPlan).toMatch(/data\.previousPlan && data\.shadowKind/);
    expect(executionPlan).toMatch(/setPlanJobId\(data\.previousPlanJobId \?\? null\)/);
    expect(executionPlan).toMatch(/setPlan\(null\)/);
    // Customer-safe translation — the raw status token is never rendered.
    expect(executionPlan).toMatch(/toCustomerSafeMessage\(\s*data\.message,\s*"This run doesn't have a saved plan yet/);
    // Carries the exact source job of the displayed plan.
    expect(executionPlan).toContain("setPlanJobId(data.jobId ?? null)");
    // Stale-response guard: late responses from a superseded load are dropped.
    expect(executionPlan).toMatch(/seq !== loadSeqRef\.current\) return/);
  });

  it("declares run lineage on the ActivePlan response contract used by the preview panel", () => {
    const activePlanInterface = orchestratorPanel.slice(
      orchestratorPanel.indexOf("interface ActivePlan {"),
      orchestratorPanel.indexOf("}", orchestratorPanel.indexOf("interface ActivePlan {")),
    );
    // Lineage fields consumed by the component MUST be part of the declared
    // contract — consuming undeclared response fields breaks typecheck and
    // hides drift between server response shape and client expectations.
    expect(activePlanInterface).toMatch(/runId\?:\s*string \| null/);
    expect(activePlanInterface).toMatch(/isStale\?:\s*boolean/);
    // The cross-run rejection guard actually uses the declared field.
    expect(orchestratorPanel).toMatch(/data\.runId !== runId\) return/);
  });

  it("chains the preview's active-plan fetch to the run fetchLatest just resolved", () => {
    // The refresh cycle must resolve the current run FIRST and pin the
    // active-plan request to that exact returned ID — never a job ID captured
    // by a prior render. Otherwise a just-started run can render alongside
    // the previous run's plan (older-plan substitution).
    const cycle = orchestratorPanel.slice(
      orchestratorPanel.indexOf("const refreshRunState = useCallback"),
      orchestratorPanel.indexOf("}, [fetchLatest, fetchActivePlan]);"),
    );
    expect(cycle).toMatch(/const seq = \+\+fetchSeqRef\.current/);
    expect(cycle).toMatch(/const runId = await fetchLatest\(seq\)/);
    expect(cycle).toMatch(/await fetchActivePlan\(runId, seq\)/);
    // fetchLatest must be sequenced before fetchActivePlan inside the cycle.
    expect(cycle.indexOf("fetchLatest(seq)")).toBeLessThan(cycle.indexOf("fetchActivePlan(runId, seq)"));
    // No caller may pass a render-captured job ID into fetchActivePlan.
    expect(orchestratorPanel).not.toMatch(/fetchActivePlan\(job\?\.id/);
  });

  it("clears the previous run's plan when a new run appears or starts (fail closed, no substitution)", () => {
    // fetchLatest: run identity change → drop old plan before committing new job.
    const fetchLatestBody = orchestratorPanel.slice(
      orchestratorPanel.indexOf("const fetchLatest = useCallback"),
      orchestratorPanel.indexOf("const fetchActivePlan = useCallback"),
    );
    expect(fetchLatestBody).toMatch(/shownRunIdRef\.current !== data\.id/);
    expect(fetchLatestBody).toMatch(/setActivePlan\(null\)/);
    // Both stale-cycle guards: after the latest fetch and after the summaries fetch.
    expect(fetchLatestBody.match(/seq !== fetchSeqRef\.current\) return null/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // fetchActivePlan: monotonic cycle guard + cross-run response rejection.
    const fetchPlanBody = orchestratorPanel.slice(
      orchestratorPanel.indexOf("const fetchActivePlan = useCallback"),
      orchestratorPanel.indexOf("const refreshRunState = useCallback"),
    );
    expect(fetchPlanBody).toMatch(/seq !== fetchSeqRef\.current\) return/);
    expect(fetchPlanBody).toMatch(/data\.runId !== runId\) return/);
    // Starting a new run invalidates in-flight cycles and clears the old plan.
    const runPipeline = orchestratorPanel.slice(
      orchestratorPanel.indexOf("const handleRunPipeline = useCallback"),
      orchestratorPanel.indexOf("}, [selectedCampaignId, running]);"),
    );
    expect(runPipeline).toMatch(/fetchSeqRef\.current\+\+/);
    expect(runPipeline).toMatch(/setActivePlan\(null\)/);
    expect(runPipeline).toMatch(/shownRunIdRef\.current = null/);
  });

  it("makes the real-run verifier reject an older campaign plan or snapshot", () => {
    expect(realRunVerifier).toMatch(/WHERE account_id=\$1 AND campaign_id=\$2 AND job_id=\$3/);
    expect(realRunVerifier).toContain('CURRENT_RUN_PLAN_NOT_PERSISTED');
    expect(realRunVerifier).not.toMatch(/strategic_plans WHERE campaign_id=\$1 ORDER BY created_at DESC/);
    expect(realRunVerifier).toMatch(/build_plan_snapshots WHERE account_id=\$1 AND campaign_id=\$2 AND job_id=\$3/);
  });

  it("serves selected-run plans and summaries rather than campaign-latest substitutes", () => {
    const activePlanHandler = orchestratorRoutes.slice(
      orchestratorRoutes.indexOf('app.get("/api/plans/active/:campaignId"'),
      orchestratorRoutes.indexOf('app.post("/api/plans/:planId/approve"'),
    );
    const summariesHandler = orchestratorRoutes.slice(
      orchestratorRoutes.indexOf('app.get("/api/orchestrator/summaries/:campaignId"'),
      orchestratorRoutes.indexOf('app.get("/api/engines/table-summary"'),
    );
    expect(activePlanHandler).toMatch(/eq\(orchestratorJobs\.id, resolved\.runId!\)/);
    expect(activePlanHandler).toContain("isPlanFromSelectedRun");
    expect(summariesHandler).toMatch(/eq\(orchestratorJobs\.id, resolved\.runId\)/);
    expect(summariesHandler).not.toContain("/api/audience-engine/latest");
    expect(summariesHandler).not.toContain("FROM mi_snapshots");
  });

  it("protects preview refreshes from late cross-run responses", () => {
    expect(buildThePlan).toContain("activePollJobRef");
    expect(buildThePlan).toMatch(/planData\?\.runId !== jId/);
    expect(buildThePlan).toMatch(/planData\?\.plan\?\.id !== data\.planId/);
    expect(engineTable).toMatch(/jobId\?: string \| null/);
    expect(engineTable).toMatch(/searchParams\.set\('runId', jobId\)/);
    expect(engineTable).toMatch(/data\?\.id !== jobId/);
  });

  it("continues polling the exact existing job after a 409 already-running response", () => {
    const recoveryBranch = buildThePlan.slice(
      buildThePlan.indexOf("if (res.status === 409 && data.jobId)"),
      buildThePlan.indexOf("setError(`[${data.status", buildThePlan.indexOf("if (res.status === 409 && data.jobId)")),
    );
    expect(recoveryBranch).toMatch(/activePollJobRef\.current = data\.jobId;/);
    expect(recoveryBranch.indexOf("activePollJobRef.current = data.jobId")).toBeLessThan(
      recoveryBranch.indexOf("pollingRef.current = setInterval"),
    );
    expect(recoveryBranch).toMatch(/pollJobStatus\(data\.jobId\)/);
  });
});