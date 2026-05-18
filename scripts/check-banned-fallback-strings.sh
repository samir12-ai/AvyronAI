#!/usr/bin/env bash
# CLP-05 / Phase 1 (May 2026) — banned fallback strings gate.
#
# These English phrases were hand-written into engine catch-blocks and
# surfaced to customers as if AI-derived. The forensic audit (E-3, E-4,
# E-5 in `.local/plans/intelligence-forensic-audit.md`) traced multiple
# misleading dashboards back to these strings. They MUST NEVER reappear.
#
# Adding a new banned phrase: append to BANNED_PATTERNS below + an
# inline justification comment. Suppressions are NOT supported — if you
# need the string for a legitimate reason (test fixture, archived doc)
# put it under the ALLOWED_PATHS allowlist below.

set -euo pipefail

# Phrases that historically baked outcomes into degraded paths.
BANNED_PATTERNS=(
  'Structured Conversion Journey'
  'Progressive Engagement Path'
  'Generic Direct Funnel'
  'Primary Conversion Funnel'         # only allowed inside parsed?.primary?.name ?? <real LLM string>
  'Alternative Engagement Funnel'
  'Rejected Generic Funnel'
)

# Files allowed to contain these phrases (tests, archives, this script).
ALLOWED_PATHS=(
  'scripts/check-banned-fallback-strings.sh'
  '.local/plans/'
  '.local/docs/'
  'server/tests/'
)

# Build ripgrep allowlist arg.
RG_GLOBS=()
for p in "${ALLOWED_PATHS[@]}"; do
  RG_GLOBS+=("-g" "!${p}**")
done

FAIL=0
for pat in "${BANNED_PATTERNS[@]}"; do
  if rg --no-heading --line-number "${RG_GLOBS[@]}" -F "${pat}" server/ 2>/dev/null; then
    echo ""
    echo "❌ Banned fallback string detected: \"${pat}\""
    echo "   Replace with explicit STATUS.AI_DEGRADED / INSUFFICIENT_EVIDENCE + reason."
    echo "   See .local/plans/intelligence-closure-plan.md CLP-05."
    FAIL=1
  fi
done

if [[ "${FAIL}" -ne 0 ]]; then
  exit 1
fi

echo "✅ check-banned-fallback-strings: no banned phrases under server/"
