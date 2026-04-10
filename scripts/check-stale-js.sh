#!/usr/bin/env bash
# check-stale-js.sh
# CI/pre-deploy check: fail if any .js file co-exists with a .ts file of the same basename.
# This detects stale pre-compiled artifacts that shadow TypeScript sources and cause
# incorrect module resolution under concurrent load.
#
# Usage:
#   bash scripts/check-stale-js.sh          # check server/ only (default)
#   bash scripts/check-stale-js.sh --all    # check entire project (excluding node_modules)
#
# Exit codes:
#   0  — clean (no stale artifacts found)
#   1  — violations found (fail build)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${1:-}" == "--all" ]]; then
  SEARCH_ROOT="$PROJECT_ROOT"
  EXCLUDE_PATHS=( -not -path "*/node_modules/*" -not -path "*/server_dist/*" -not -path "*/.git/*" -not -path "*/dist/*" )
else
  SEARCH_ROOT="$PROJECT_ROOT/server"
  EXCLUDE_PATHS=( -not -path "*/node_modules/*" -not -path "*/server_dist/*" )
fi

echo "[ArtifactCheck] Scanning for stale .js artifacts alongside .ts sources in: $SEARCH_ROOT"

VIOLATIONS=0
VIOLATION_LIST=()

while IFS= read -r js_file; do
  ts_file="${js_file%.js}.ts"
  if [[ -f "$ts_file" ]]; then
    rel_js="${js_file#$PROJECT_ROOT/}"
    rel_ts="${ts_file#$PROJECT_ROOT/}"
    echo "[ArtifactCheck] VIOLATION: $rel_js shadows $rel_ts"
    VIOLATION_LIST+=("$rel_js")
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "$SEARCH_ROOT" "${EXCLUDE_PATHS[@]}" -name "*.js" -type f)

if [[ $VIOLATIONS -eq 0 ]]; then
  echo "[ArtifactCheck] PASSED — no stale .js artifacts detected"
  exit 0
else
  echo ""
  echo "[ArtifactCheck] FAILED — found $VIOLATIONS stale .js artifact(s)"
  echo "[ArtifactCheck] These files shadow their .ts counterparts and cause incorrect module"
  echo "[ArtifactCheck] resolution under concurrent load (may load old compiled code at runtime)."
  echo "[ArtifactCheck] Delete the listed .js files before deploying."
  exit 1
fi
