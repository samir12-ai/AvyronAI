const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noSemanticFallback = require('./.local/eslint-rules/no-semantic-fallback.js');
const noDirectStrategyMemoryWrite = require('./.local/eslint-rules/no-direct-strategy-memory-write.js');
const noValidateDecisionMemoryWriteImport = require('./.local/eslint-rules/no-validate-decision-memory-write-import.js');
const noBareLlmCallInReplay = require('./.local/eslint-rules/no-bare-llm-call-in-replay.js');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // H6 + H8 (2026-05-10): Semantic Contract Hardening — forbid semantic
  // fallback patterns (?? / || / ternary) on live decision/reporting paths.
  // Doctrine D1: no semantic fallback.
  //
  // Scope (H8 widened): every dir that performs live decisions, evaluates
  // verdicts, propagates trust, or emits decision-bearing snapshots. Engine
  // INTERNALS (server/*-engine/engine.ts) are intentionally excluded — those
  // modules use `status`/`verdict`/`outcome` as DOMAIN content fields (offer
  // transformation outcome, AI judge accept/reject verdict, lead pipeline
  // status), which would explode false positives. Engines emit canonical
  // contract fields via the registry, which IS in scope through the
  // orchestrator/contract-registry path.
  {
    files: [
      // Original H6 scope.
      "server/agent/**/*.ts",
      "server/system-control/**/*.ts",
      "server/orchestrator/**/*.ts",
      "server/build-plan-layer/**/*.ts",
      "server/recovery-*/**/*.ts",
      // H8 widening — additional decision-bearing dirs.
      "server/shared/**/*.ts",
      "server/decision-policy/**/*.ts",
      "server/engine-contracts/**/*.ts",
      "server/engine-contracts.ts",
      "server/engine-hardening/**/*.ts",
      "server/gates/**/*.ts",
      "server/causal-enforcement-layer/**/*.ts",
      "server/analytical-enrichment-layer/**/*.ts",
      "server/execution-activation/**/*.ts",
      "server/adaptive-rhythm/**/*.ts",
      "server/memory-mutation/**/*.ts",
      "server/audits/**/*.ts",
      "server/audit.ts",
      "server/audit-routes.ts",
      "server/autonomous-worker.ts",
      "server/autopilot-routes.ts",
      "server/decision-attribution.ts",
      // Seal #9 / F10.2 widening — strategy engines (channel-selection,
      // budget-governor, statistical-validation, iteration-engine,
      // retention-engine) emit canonical verdict-shape fields
      // (validationState, decision.action, primaryChannel.decisionGate.outcome)
      // and must obey D1.
      "server/strategy/**/*.ts",
      // Seal #9 / F10.2 — legacy engine internals are now in scope per task
      // spec. Genuine D1 violations are rewritten; the legitimate authoring
      // sites (where the engine COMPOSES its own canonical F1 status from a
      // boolean guard result) carry narrowly-scoped in-line eslint-disable
      // with documented rationale at each site (the assignment IS the
      // canonical source, not a substitute for a missing canonical field
      // from another engine — D1 forbids the latter, not the former).
      "server/*-engine/engine.ts",
    ],
    plugins: {
      semantic: { rules: { "no-semantic-fallback": noSemanticFallback } },
    },
    rules: {
      "semantic/no-semantic-fallback": "error",
    },
  },
  // Task #64 / Phase 1 — Canonical Fact Ownership.
  // Forbids direct db.insert/db.update(strategyMemory) outside the
  // authoritative writer module. memoryStore is the single writer.
  {
    files: ["server/**/*.ts"],
    ignores: [
      // The store module is the authoritative writer.
      "server/memory-system/store.ts",
      // Tests may construct fixture rows directly.
      "server/tests/**/*.ts",
      "server/migrations/**/*.ts",
    ],
    plugins: {
      "canonical-fact": { rules: { "no-direct-strategy-memory-write": noDirectStrategyMemoryWrite } },
    },
    rules: {
      "canonical-fact/no-direct-strategy-memory-write": "error",
    },
  },
  // Task #66 / Phase 3 — Enforcement Consolidation.
  // Forbids importing `validateDecisionForMemoryWrite` outside the
  // decision-policy module + the approved consumer list. Re-opening the
  // dual-gate seam (a second consumer of the gate function) would
  // re-introduce the divergence Phase 1 closed.
  {
    files: ["server/**/*.ts"],
    ignores: [
      "server/tests/**/*.ts",
      "server/migrations/**/*.ts",
    ],
    plugins: {
      "decision-policy": {
        rules: { "no-validate-decision-memory-write-import": noValidateDecisionMemoryWriteImport },
      },
    },
    rules: {
      "decision-policy/no-validate-decision-memory-write-import": "error",
    },
  },
  // Task #89 / Phase 4-A — Replay / Shadow Harness.
  // (A) Inside server/orchestrator/replay/**: forbid direct LLM imports —
  //     replay code MUST route through StrictLlmMock.
  // (B) Inside server/orchestrator/** (excluding replay/): forbid bare
  //     recorder.record*() calls — every boundary MUST go through the
  //     variable returned by withReplayRecorder(...) (named `__recorder`).
  {
    files: ["server/orchestrator/**/*.ts"],
    plugins: {
      "orchestrator-replay": { rules: { "no-bare-llm-call-in-replay": noBareLlmCallInReplay } },
    },
    rules: {
      "orchestrator-replay/no-bare-llm-call-in-replay": "error",
    },
  },
]);
