# extraction-dispatch — Task #90 / Phase 4-B seam

Single point through which every extracted orchestrator module is
invoked. Hosts the `dispatchExtraction()` HOF, the CV-14
`ExtractionDriftDetection` metric family, and the auto-revert supervisor.

## Files
- `index.ts` — `dispatchExtraction<I,O>()`, `resolveDispatchMode()`,
  `defaultJsonDiff()`. Strict-enum types (D3): `DispatchMode`,
  `DispatchOutcome`, `DivergenceSeverity`.
- `cv14-metrics.ts` — counters (`cv14_module_extraction_divergences_total`,
  `orch_module_dispatch_total`, `cv14_module_candidate_error_total`) +
  Prometheus text renderer.
- `auto-revert-supervisor.ts` — polls divergence counts, flips
  `ORCH_USE_<MODULE>` back to `current` on any `major|fatal` event
  while the flag is `candidate`.

## Dispatch modes (per-module via `ORCH_USE_<MODULE_FLAG>`)
| Mode | Behavior |
|---|---|
| `current` (default) | Only legacy inline implementation runs. ZERO behavior change vs pre-Task-#90. |
| `candidate` | Only extracted module runs. Candidate throws are NOT caught here — operator opt-in is explicit. |
| `shadow` | Both run; `current` result is returned; divergences feed CV-14 + DB ledger. |

## Doctrine compliance
- **D1**: no `?? status` / `|| verdict` fallbacks. Mode resolution is an
  explicit `if/else` chain (`resolveDispatchMode`), not a logical-or
  collapse.
- **D3**: every union is `z.enum`-equivalent string-literal union.
- **D5**: `compare()` returns `null` to denote MATCH. Callers MUST NOT
  fallback-coerce.

## Operator runbook
- **Alarm**: `cv14_module_extraction_divergences_total{severity="major"}` rate > 0
  while `ORCH_USE_<X>=candidate` → supervisor auto-reverts; investigate
  `orchestrator_extraction_divergences` rows for `module_id=X`.
- **Promotion**: bump `ORCH_USE_<X>=shadow` for 48h; require zero
  divergences across ≥3 full corpus replays; bump to `candidate`.
- **Rollback**: set `ORCH_USE_<X>=current` (env-only, no code change).

See [`.local/docs/p4b-extractions/rollback-runbook.md`](../../../.local/docs/p4b-extractions/rollback-runbook.md).
