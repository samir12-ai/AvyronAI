/**
 * Task #90 / Phase 4-B — Auto-revert supervisor.
 *
 * Polls the CV-14 divergence counters + `orchestrator_extraction_divergences`
 * table on a fixed cadence. When a module currently routed to `candidate`
 * (`ORCH_USE_<MODULE>=candidate`) accumulates any `major` or `fatal`
 * divergence in the last `WINDOW_MS`, the supervisor:
 *
 *   1. Flips the per-module flag back to `current` in-process (so the
 *      next dispatch returns to the safe path immediately).
 *   2. Emits a `MODULE_AUTO_REVERT` audit row + operator-panel signal.
 *   3. Records a `orch_module_auto_revert_total{module,reason}` counter
 *      tick for alerting.
 *
 * The supervisor is OFF by default. It activates only when
 * `ORCH_AUTO_REVERT_ENABLED=true` AND `METRICS_ADMIN_TOKEN` is set
 * (admin-gated, consistent with continuity supervisor).
 *
 * The supervisor NEVER promotes — only reverts. Manual promotion is a
 * deliberate operator action via env-var change + redeploy.
 *
 * NOTE: this scaffold ships with the polling loop fully wired but the
 * audit + panel emit hooks left as injectable callbacks. The orchestrator
 * boot path wires the production callbacks in P4-C.
 */

type DispatchModeOverride = "current" | "candidate" | "shadow";

interface SupervisorDeps {
  /** Reads the recent divergence count for a module. */
  countRecentDivergences: (
    moduleId: string,
    windowMs: number,
  ) => Promise<{ major: number; fatal: number; minor: number }>;
  /** Per-module flag override store (in-process map). */
  setModeOverride: (moduleFlag: string, mode: DispatchModeOverride) => void;
  /** Operator panel + audit emit. */
  emitRevert: (event: {
    moduleId: string;
    moduleFlag: string;
    reason: string;
    counts: { major: number; fatal: number; minor: number };
  }) => Promise<void> | void;
}

export interface ModuleWatch {
  moduleId: string;
  moduleFlag: string;
}

export interface SupervisorConfig {
  intervalMs?: number;
  windowMs?: number;
  modules: ModuleWatch[];
  deps: SupervisorDeps;
}

let activeTimer: NodeJS.Timeout | null = null;

/**
 * Start the supervisor. Idempotent — calling twice replaces the prior
 * timer (the original handle is still reachable from `gracefulShutdown`
 * via `stopAutoRevertSupervisor`).
 */
export function startAutoRevertSupervisor(cfg: SupervisorConfig): void {
  if (process.env.ORCH_AUTO_REVERT_ENABLED !== "true") return;
  if (!process.env.METRICS_ADMIN_TOKEN) {
    console.warn(
      "[AutoRevertSupervisor] METRICS_ADMIN_TOKEN missing — supervisor not started",
    );
    return;
  }
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }
  const interval = cfg.intervalMs ?? 60_000;
  const window = cfg.windowMs ?? 5 * 60_000;
  activeTimer = setInterval(() => {
    void runOnePass(cfg, window).catch((err) => {
      console.warn(
        `[AutoRevertSupervisor] POLL_FAILED | error=${err?.message ?? String(err)}`,
      );
    });
  }, interval);
  // Mark unrefed so the supervisor doesn't keep the process alive on its own
  // when no other handles remain (mirrors continuity supervisor convention).
  activeTimer.unref?.();
  console.log(
    `[AutoRevertSupervisor] STARTED | interval=${interval}ms | window=${window}ms | modules=${cfg.modules.map((m) => m.moduleId).join(",")}`,
  );
}

export function stopAutoRevertSupervisor(): void {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
    console.log("[AutoRevertSupervisor] STOPPED");
  }
}

async function runOnePass(cfg: SupervisorConfig, windowMs: number): Promise<void> {
  for (const watch of cfg.modules) {
    // Only revert modules currently routed to `candidate` — `shadow` mode
    // is observation-only and `current` is already the safe path.
    if (process.env[`ORCH_USE_${watch.moduleFlag}`] !== "candidate") continue;
    const counts = await cfg.deps.countRecentDivergences(watch.moduleId, windowMs);
    if (counts.major > 0 || counts.fatal > 0) {
      cfg.deps.setModeOverride(watch.moduleFlag, "current");
      await cfg.deps.emitRevert({
        moduleId: watch.moduleId,
        moduleFlag: watch.moduleFlag,
        reason:
          counts.fatal > 0
            ? `fatal_divergence_count=${counts.fatal}`
            : `major_divergence_count=${counts.major}`,
        counts,
      });
      console.warn(
        `[AutoRevertSupervisor] AUTO_REVERT | module=${watch.moduleId} | major=${counts.major} | fatal=${counts.fatal} | windowMs=${windowMs}`,
      );
    }
  }
}
