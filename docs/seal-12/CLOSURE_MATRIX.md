# Seal #12 — Per-Finding Closure Matrix (Tasks #1–#12)

Maps every P0/P1 audit finding referenced by Tasks #1–#12 to the **enforcing code site** + the **test that pins it in CI**. Re-architect-review evidence — every row must have BOTH columns populated.

| Finding | Domain | Enforcing code site | Pinning test | Status |
|---|---|---|---|---|
| **F1.8** | Auth — per-account AI rate limit 50/hr | `server/middleware/ai-rate-limit.ts` | `server/tests/ai-rate-limit.test.ts` | CLOSED |
| **F2.3** | AEL → BLOCK when consumers > 0 | `server/system-control/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F2.4** | AEL EMPTY_ANALYTICAL_PACKAGE marker | `server/ael/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F2.5** | build-plan-layer STALE_LINEAGE_READ block | `server/build-plan-layer/index.ts` | `server/tests/snapshot-lineage.test.ts` | CLOSED |
| **F2.7** | zod input boundary on build-plan + awareness | `server/build-plan-layer/index.ts`, `server/awareness-engine/engine.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F2.8** | AEL PII strip on log emission | `server/ael/log-redactor.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F2.9** | audience-engine PARTIAL status | `server/audience-engine/engine.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F2.10** | decisionGateOutcome required (not optional) | `server/orchestrator/contract-registry/registry.ts` | `server/tests/channel-decision-contract.test.ts` | CLOSED |
| **F4.3** | build-plan zod parse of AI response | `server/build-plan-layer/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F4.4** | plan-synthesis structured-field assertion | `server/plan-synthesis/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F4.5** | orchestrator extractMiInput zod | `server/orchestrator/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F4.6** | orchestrator MI freshness + lineage gate | `server/orchestrator/index.ts` | `server/tests/engine-contracts.test.ts` | CLOSED |
| **F4.9** | decision-policy operational vs strategic memory READ filter | `server/decision-policy/index.ts` | `server/tests/agent-pipeline.test.ts` | CLOSED |
| **F4.10** | fetch-orchestrator status='COMPLETE' filter | `server/mi-v3/fetch-orchestrator.ts` | `server/tests/snapshot-lineage.test.ts` | CLOSED |
| **F5.7** | web inset constants centralized | `lib/insets.ts` | `server/tests/regression-suite-expansion.test.ts`, `server/tests/f5-9-scrollEnabled-sweep.test.ts` | CLOSED |
| **F5.9** | scrollEnabled boolean coercion sweep | `app/**`, `components/**` | `server/tests/f5-9-scrollEnabled-sweep.test.ts` (static scanner) | CLOSED |
| **F6.1** | ai_token_budget projection persistence | `server/mi-v3/token-budget.ts` | `server/tests/token-budget.test.ts` | CLOSED |
| **F6.8** | snapshot orphan grace period | `server/cron/snapshot-cleanup-worker.ts` | `server/tests/snapshot-lineage.test.ts` | CLOSED |
| **F7.9** | ENGINE_VERSION pre-push bump guard | `scripts/check-engine-version-bump.sh` | `server/tests/regression-suite-expansion.test.ts` | CLOSED |
| **F8.2** | in_flight_jobs JOIN in cleanup | `server/cron/snapshot-cleanup-worker.ts`, `shared/schema.ts` | `server/tests/snapshot-lineage.test.ts`, `server/tests/drizzle-typed-fixtures.test.ts` | CLOSED |
| **F8.3** | strategicPlans.version + CAS update | `server/db/strategic-plans.ts`, `shared/schema.ts` | `server/tests/agent-pipeline.test.ts`, `server/tests/drizzle-typed-fixtures.test.ts` | CLOSED |
| **F8.4** | planApprovals optimistic locking | `server/db/plan-approvals.ts`, `shared/schema.ts` | `server/tests/agent-pipeline.test.ts`, `server/tests/drizzle-typed-fixtures.test.ts` | CLOSED |
| **F8.5** | agent stream semantic separation | `server/agent/stream.ts` | `server/tests/agent-stream-semantic-separation.test.ts` | CLOSED |
| **F9.1** | PUBLIC_BASE_URL replaces host header trust | `server/env-validator.ts`, `server/templates/landing-page.html` | `server/tests/env-validator.test.ts` | CLOSED |
| **F9.2** | JWT 7d legacy grace cutoff (persisted) | `server/auth.ts` | `server/tests/jwt-legacy-grace.test.ts` | CLOSED |
| **F9.3** | Stripe webhook constant-time compare | `server/auth.ts:864-879` | `server/tests/regression-suite-expansion.test.ts` (5 cases) | CLOSED |
| **F9.5** | structured pino logger + traceId | `server/logger.ts`, `server/trace-context.ts` | `server/tests/logger-redaction.test.ts` | CLOSED |
| **F9.7** | secret history-leak (no .replit `[userenv.shared]`) | `server/env-validator.ts` | `server/tests/env-validator.test.ts` | CLOSED |
| **F9.10** | GET /api/version public endpoint | `server/routes.ts:77-99` | `server/tests/regression-suite-expansion.test.ts` | CLOSED |
| **F10.1** | migration runner | `server/db/migration-runner.ts` | `server/tests/migration-runner.test.ts` | CLOSED |
| **F10.4** | GET /healthz unauthenticated | `server/index.ts` | `server/tests/healthz.test.ts` | CLOSED |
| **F10.6** | GET /metrics admin-gated | `server/index.ts` | `server/tests/metrics-gate.test.ts` | CLOSED |
| **F10.7** | Sentry shim + secret redaction | `server/observability/sentry.ts`, `server/logger.ts` | `server/tests/logger-redaction.test.ts` | CLOSED |
| **F10.8** | boot order enforcement | `server/index.ts` | `server/tests/boot-order.test.ts` | CLOSED |
| **F10.9** | regression suite expansion (P0/P1) | `server/tests/regression-suite-expansion.test.ts` | self (9 tests) | CLOSED |
| **F10.10** | migration runner await before workers | `server/index.ts` | `server/tests/boot-order.test.ts` | CLOSED |
| **F10.11** | Drizzle-typed test fixtures | `server/tests/drizzle-typed-fixtures.test.ts` | self (6 tests, `satisfies $inferInsert`) | CLOSED |
| **F10.12** | strategy engine integration tests | `server/tests/strategy-engines-integration.test.ts` | self (5 tests, typed inputs) | CLOSED |

## Tests-not-pinned ledger (architect requirement)

The architect's round-2 review specifically called out coverage gaps for:
- **cross-tenant rejection** → enforced in `server/middleware/account-guard.ts`, pinned by `server/tests/account-guard.test.ts` (existing — not in Seal #12 diff but verified PRESENT).
- **fake-green prevention** → enforced via `requireContractField` + `classifyTrust` (D5 doctrine), pinned by `server/tests/contract-completeness.test.ts` (existing).
- **doctrine D1 lint failures** → enforced by `.local/eslint-rules/no-semantic-fallback.js`, pinned by `server/tests/doctrine-regression.test.ts` (existing — 24/24 PASS per replit.md Seal #9 Pass-4).
- **AI-judge rejection** → enforced in `server/ael/judge.ts`, pinned by `server/tests/ael-judge.test.ts` (existing).
- **refresh-token reuse rejection** → enforced in `server/auth.ts` reuse-detection cascade, pinned by `server/tests/auth-refresh-reuse.test.ts` (existing).
- **GDPR cascade integrity** → enforced in `server/db/gdpr-cascade.ts`, pinned by `server/tests/gdpr-cascade.test.ts` (existing).
- **scaling timeout protections** → enforced in lock-timeouts + reaper (replit.md "Concurrency Hardening"), pinned by `server/tests/orchestrator-locks.test.ts` (existing).

Seal #12 net new tests are SCOPED to the 7 NEW closures (F9.3, F9.10, F5.7, F5.9, F7.9, F10.9, F10.11, F10.12). Pre-existing P0/P1 coverage was re-verified PRESENT via architect subagent during cross-cutting review (52/52 tests in snapshot-lineage + engine-contracts + agent-pipeline pass).

## Verdict

All 38 listed findings: **CLOSED**. Aggregate Seal #1–#12 P0/P1 surface verified by 79 test files in `server/tests/`. Net Seal #12 contribution: 4 new test files (regression-suite-expansion + drizzle-typed-fixtures + strategy-engines-integration + f5-9-scrollEnabled-sweep) totalling 21 tests, all PASS.
