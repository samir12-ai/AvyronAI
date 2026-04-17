/**
 * Resolve a non-null jobId for snapshot writes.
 *
 * - If the caller supplied a jobId in the request body (orchestrator path), use it.
 * - Otherwise, generate a synthetic `manual_<ts>_<rand>` id.
 *
 * Run-bound dashboard reads use orchestratorJobs as the resolver source, so any
 * `manual_*` id will not be returned by /latest endpoints. This guarantees:
 *   1. No snapshot row is ever inserted with NULL jobId.
 *   2. Manual analyze calls cannot contaminate run-bound dashboard surfaces.
 */
export function resolveOrManualJobId(bodyJobId?: unknown): string {
  if (typeof bodyJobId === "string" && bodyJobId.trim().length > 0) {
    return bodyJobId.trim();
  }
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
