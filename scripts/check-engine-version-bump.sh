#!/usr/bin/env bash
# F7.9 — Pre-push guard: any commit touching the MI-V3 fetch/scrape/signal
# layer MUST also bump ENGINE_VERSION in constants.ts. Without this guard,
# stale snapshots can survive an algorithm change because the cache-bust
# key never changes.
#
# Install as a pre-push hook:
#   ln -s ../../scripts/check-engine-version-bump.sh .git/hooks/pre-push
#   chmod +x .git/hooks/pre-push
#
# Or run manually before merging:
#   ./scripts/check-engine-version-bump.sh
set -euo pipefail

WATCHED_GLOBS=(
  "server/market-intelligence-v3/signal-engine.ts"
  "server/market-intelligence-v3/fetch-orchestrator.ts"
  "server/market-intelligence-v3/website-scraper.ts"
  "server/market-intelligence-v3/instagram-scraper.ts"
  "server/market-intelligence-v3/tiktok-scraper.ts"
  "server/market-intelligence-v3/google-reviews-scraper.ts"
  "server/market-intelligence-v3/blog-scraper.ts"
)
CONSTANTS_FILE="server/market-intelligence-v3/constants.ts"

# Compare against origin/main; fall back to HEAD~1 for local dev.
BASE_REF="${BASE_REF:-origin/main}"
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  BASE_REF="HEAD~1"
fi

CHANGED="$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || true)"
if [[ -z "$CHANGED" ]]; then
  exit 0
fi

TOUCHED_WATCHED=0
for f in "${WATCHED_GLOBS[@]}"; do
  if echo "$CHANGED" | grep -Fxq "$f"; then
    TOUCHED_WATCHED=1
    break
  fi
done

if [[ "$TOUCHED_WATCHED" -eq 0 ]]; then
  exit 0
fi

if ! echo "$CHANGED" | grep -Fxq "$CONSTANTS_FILE"; then
  echo "ERROR: F7.9 — MI-V3 fetch/scrape/signal file changed but $CONSTANTS_FILE was not touched." >&2
  echo "Bump ENGINE_VERSION in $CONSTANTS_FILE to invalidate stale snapshots." >&2
  exit 1
fi

if ! git diff "$BASE_REF"...HEAD -- "$CONSTANTS_FILE" | grep -qE "^\+export const ENGINE_VERSION = [0-9]+"; then
  echo "ERROR: F7.9 — $CONSTANTS_FILE changed but ENGINE_VERSION was not bumped." >&2
  exit 1
fi

echo "[F7.9] ENGINE_VERSION bump verified."
exit 0
