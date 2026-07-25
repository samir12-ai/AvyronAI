#!/usr/bin/env bash
# Task #71 / Phase 8 / Step 8 — CI regex enforcement.
#
# Blocks reintroduction of operator-vocabulary engine names + raw doctrinal
# tokens into the customer-build UI surface (app/, components/, hooks/).
# Operator-only files are excluded so dev work isn't disrupted.
#
# Run via `bash scripts/check-engine-vocabulary.sh` — exits non-zero on hit.
#
# Doctrine context:
#   D2/D3 — canonical fields (status enum values, planSource, validationState,
#           integrityVerdict) MUST remain in code. This script only catches
#           the *user-visible* string forms — JSX literals and template
#           strings. Type/identifier matches are excluded by the regex.

set -u

cd "$(dirname "$0")/.."

# Operator vocabulary that MUST NOT appear in customer-build component copy.
# Each entry is a literal that, if matched in JSX text or string-literal
# context, is a violation. Order matters only for readable output.
ENGINE_NAMES=(
  "Positioning Engine"
  "Differentiation Engine"
  "Mechanism Engine"
  "Offer Engine"
  "Funnel Engine"
  "Integrity Engine"
  "Awareness Engine"
  "Persuasion Engine"
  "Statistical Validation Engine"
  "Budget Governor Engine"
  "Channel Selection Engine"
  "Iteration Engine"
  "Retention Engine"
  # Unsuffixed canonical-internal names — these are how some operator
  # tabs render (e.g., "Statistical Validation" without "Engine"). They
  # are still operator vocabulary and MUST NOT appear in customer JSX.
  "Statistical Validation"
  "Budget Governor"
  "Channel Selection"
)

# Raw doctrinal tokens that MUST NOT leak past the i18n boundary as JSX
# text (they may still appear as canonical field values or enum members).
RAW_TOKENS=(
  "CHAIN_DEGRADED"
  "CHAIN_DEAD"
  "MARKET_DATA_DEGRADED"
  "PLAN_DEGRADED"
  "SCHEDULER_HEARTBEAT_DEAD"
  "SCRAPER_PROVIDER_DEGRADED"
  "WORKER_STUCK"
  "RETRY_LOOP"
  "LEAKED_LOCK"
  "AI_QUOTA_PRESSURE"
  "GPT-5.2"
  "Gemini 3 Pro"
  # Post-audit vocabulary sweep (sprint cleanup) — phrases the audit flagged
  # as operator vocabulary leaking into customer copy. Each was replaced
  # with outcome-framed phrasing; this denylist prevents reintroduction.
  "Drift detected"
  "drift detected"
  "trusted signal"
  "fallback isolated"
  "Contract incomplete"
  "Live evidence"
  "Reused snapshot"
  # Note: "system_untrusted" is an internal truthfulness enum value used
  # in switch cases — it never reaches the user; the presenter layer maps
  # it to "Limited confidence". Kept off this denylist to avoid false
  # positives on internal contract code paths.
  "Plan Binding"
)

# Files in this customer-build set are scanned. Operator-only files where
# operator vocabulary is legitimate are EXCLUDED.
SCAN_PATHS=(
  "app/(tabs)"
  "components/NarrativeCard.tsx"
  "components/ExecutionPlan.tsx"
  "components/RunTruthfulnessBanner.tsx"
  "components/PlanDocumentView.tsx"
  "components/BuildThePlan.tsx"
  "components/ReasoningPanel.tsx"
  "components/ReasoningCard.tsx"
)
EXCLUDE_FILES=(
  "app/audit-control.tsx"
  "components/AELDebugPanel.tsx"
  "components/SignalFlowPanel.tsx"
  "components/SystemIntegrityPanel.tsx"
  "components/OrchestratorPanel.tsx"
  "components/MarketDatabaseAdmin.tsx"
  # Task #71 / Phase 8 — operator label tables extracted to a sibling
  # module so ai-management.tsx itself (the highest-risk nav-copy file)
  # IS now scanned. The operator-only module is the sole exclusion here.
  "app/(tabs)/_ai-management-operator-labels.ts"
  "hooks/useOperatorNotices.ts"
  "hooks/useContinuityPanel.ts"
  "hooks/useOperationsPanel.ts"
)

# Build ripgrep exclude args
RG_EXCLUDES=()
for f in "${EXCLUDE_FILES[@]}"; do
  RG_EXCLUDES+=(-g "!${f}")
done

violations=0

scan() {
  local label="$1"
  shift
  local terms=("$@")
  for term in "${terms[@]}"; do
    # -F = fixed-string; -n = line numbers; we scan SCAN_PATHS only.
    if hits=$(rg -nF "${term}" "${SCAN_PATHS[@]}" "${RG_EXCLUDES[@]}" 2>/dev/null); then
      if [ -n "${hits}" ]; then
        echo "[engine-vocab] ${label} violation — '${term}':"
        echo "${hits}" | sed 's/^/  /'
        violations=$((violations + 1))
      fi
    fi
  done
}

scan "internal engine name" "${ENGINE_NAMES[@]}"
scan "raw doctrinal token" "${RAW_TOKENS[@]}"

if [ "${violations}" -gt 0 ]; then
  echo ""
  echo "[engine-vocab] ${violations} forbidden term(s) found in customer-build surface."
  echo "[engine-vocab] Either move the file to the operator-only allowlist OR"
  echo "[engine-vocab] route the copy through the i18n outcome-framed map."
  exit 1
fi

echo "[engine-vocab] clean (${#ENGINE_NAMES[@]} engine names + ${#RAW_TOKENS[@]} doctrinal tokens checked)."
exit 0
