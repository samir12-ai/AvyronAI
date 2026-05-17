/**
 * Task #68 / Phase 5 Step 7 — CV-04 (Contract Completeness Verification) metric.
 *
 * Emits one counter family per contract-audit outcome:
 *   - status:   COMPLETE | INCOMPLETE | INVALID | ERROR | LEGACY_NONE | SKIPPED
 *   - engineId: the audited engine id
 *   - enforced: "true" | "false" — whether ENFORCE_ENGINE_CONTRACTS was on
 *
 * Doctrine (CV-04): zero INCOMPLETE / INVALID leaks to live decisions once
 * enforcement flips. While `enforced="false"` (shadow phase), any non-zero
 * INCOMPLETE/INVALID rate is the operator signal that an engine is still
 * emitting an incomplete output and must be fixed before flip.
 *
 * Wiring follows the lightweight Counter shape used by CV-06
 * (server/memory-system/cv06-metrics.ts) so the Prometheus exposition can
 * iterate without prom-client.
 */

type Status = "COMPLETE" | "INCOMPLETE" | "INVALID" | "ERROR" | "LEGACY_NONE" | "SKIPPED";

interface Labels {
  status: Status;
  engineId: string;
  enforced: "true" | "false";
}

class InMemoryCounter {
  private readonly counts = new Map<string, number>();
  private key(l: Labels): string {
    return `${l.status}|${l.engineId}|${l.enforced}`;
  }
  inc(l: Labels): void {
    const k = this.key(l);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  collect(): Array<Labels & { value: number }> {
    return Array.from(this.counts.entries()).map(([k, value]) => {
      const [status, engineId, enforced] = k.split("|");
      return { status: status as Status, engineId, enforced: enforced as "true" | "false", value };
    });
  }
  reset(): void {
    this.counts.clear();
  }
}

const cv04ContractAuditsTotal = new InMemoryCounter();

/**
 * Shadow-phase leak counter — separate from the audit outcomes so the
 * "zero INCOMPLETE leaks to live decisions" assertion is directly
 * observable. Doctrine semantics:
 *
 *   - When `enforced=false` (shadow phase): an INCOMPLETE/INVALID engine
 *     result is committed to the orchestrator's results map AS-IS — it
 *     IS a true live-decision leak, just one the operator has temporarily
 *     accepted while populating contracts. This is what the counter
 *     measures, and it MUST trend to zero before ENFORCE_ENGINE_CONTRACTS
 *     flips. Tracked via `cv04_shadow_leaks_total`.
 *
 *   - When `enforced=true` (cutover): `audit.ts` structurally downgrades
 *     `stepResult.status` to CONTRACT_INCOMPLETE before the result is
 *     consumed downstream, so a true leak is impossible by construction.
 *     We therefore DO NOT increment the leak counter in this branch —
 *     doing so would over-report leaks and create false P0 alerts. The
 *     downgrade itself is observable through the engine's
 *     `CONTRACT_INCOMPLETE` status and the existing audit-outcome
 *     counter (`cv04_contract_audits_total{status="INCOMPLETE"}`).
 */
class LeakCounter {
  private readonly counts = new Map<string, number>();
  inc(engineId: string, leakStatus: "INCOMPLETE" | "INVALID"): void {
    const k = `${leakStatus}|${engineId}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }
  collect(): Array<{ leakStatus: "INCOMPLETE" | "INVALID"; engineId: string; value: number }> {
    return Array.from(this.counts.entries()).map(([k, value]) => {
      const [leakStatus, engineId] = k.split("|");
      return { leakStatus: leakStatus as "INCOMPLETE" | "INVALID", engineId, value };
    });
  }
  reset(): void {
    this.counts.clear();
  }
}

const cv04ShadowLeaksTotal = new LeakCounter();

export function recordContractAuditOutcome(
  status: Status,
  engineId: string,
  enforced: boolean,
): void {
  cv04ContractAuditsTotal.inc({ status, engineId, enforced: enforced ? "true" : "false" });
  // Shadow-leak counter increments ONLY when the result actually passes
  // through to the orchestrator results map without being downgraded.
  // That is the case iff (status is INCOMPLETE|INVALID) AND
  // (enforced=false). When enforced=true, audit.ts downgrades the engine
  // step to CONTRACT_INCOMPLETE so no live decision consumes the bad
  // output — counting that here would create false P0 alerts.
  if ((status === "INCOMPLETE" || status === "INVALID") && !enforced) {
    cv04ShadowLeaksTotal.inc(engineId, status);
  }
}

/** Test helper. Not for production use. */
export function _resetCv04MetricsForTests(): void {
  cv04ContractAuditsTotal.reset();
  cv04ShadowLeaksTotal.reset();
}

/** Test/audit helper — read the current leak counts as a flat array. */
export function _getCv04LeakSamples(): Array<{ leakStatus: "INCOMPLETE" | "INVALID"; engineId: string; value: number }> {
  return cv04ShadowLeaksTotal.collect();
}

/**
 * Prometheus exposition text. Mounted on /metrics in server/index.ts alongside
 * renderMetrics(), renderContinuityMetrics(), and renderCv06Metrics().
 *
 * Steady-state expectation:
 *   - status="COMPLETE" — bulk of traffic; healthy.
 *   - status="INCOMPLETE" or status="INVALID" with enforced="false" — shadow
 *     signal that an engine needs fixing before ENFORCE_ENGINE_CONTRACTS flips.
 *   - status="INCOMPLETE" or "INVALID" with enforced="true" — P0: a live
 *     decision was made on a contract-incomplete engine output.
 */
export function renderCv04Metrics(): string {
  const samples = cv04ContractAuditsTotal.collect();
  const leakSamples = cv04ShadowLeaksTotal.collect();
  const lines: string[] = [];
  lines.push(`# HELP cv04_contract_audits_total CV-04: outcomes of every per-engine contract audit (shadow + enforced).`);
  lines.push(`# TYPE cv04_contract_audits_total counter`);
  for (const s of samples) {
    const labels = `status="${s.status}",engineId="${s.engineId.replace(/"/g, "\\\"")}",enforced="${s.enforced}"`;
    lines.push(`cv04_contract_audits_total{${labels}} ${s.value}`);
  }
  lines.push(`# HELP cv04_shadow_leaks_total CV-04: INCOMPLETE/INVALID engine results committed to live decisions during shadow phase (enforced=false). MUST trend to zero before ENFORCE_ENGINE_CONTRACTS flip. Not incremented when enforced=true — audit.ts downgrades the engine step so the live-decision leak is structurally impossible.`);
  lines.push(`# TYPE cv04_shadow_leaks_total counter`);
  for (const s of leakSamples) {
    const labels = `leakStatus="${s.leakStatus}",engineId="${s.engineId.replace(/"/g, "\\\"")}"`;
    lines.push(`cv04_shadow_leaks_total{${labels}} ${s.value}`);
  }
  return lines.join("\n");
}
