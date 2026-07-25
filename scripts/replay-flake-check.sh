#!/usr/bin/env bash
# Task #89 / Phase 4-A — replay-flake-check.sh.
#
# Runs the orchestrator-replay vitest suite N times in a row (default 100).
# Any single failed iteration is a doctrine violation — must be root-caused,
# do NOT retry. Mirrors scripts/lifecycle-flake-check.sh.
set -euo pipefail
ITERS=${1:-100}
PASS=0
FAIL=0
for i in $(seq 1 "$ITERS"); do
  if npx vitest run server/tests/orchestrator-replay --reporter=basic > /tmp/replay-flake-$i.log 2>&1; then
    PASS=$((PASS + 1))
    printf "."
  else
    FAIL=$((FAIL + 1))
    echo
    echo "FAIL iter=$i — log at /tmp/replay-flake-$i.log"
  fi
done
echo
echo "Replay flake-check complete: pass=$PASS fail=$FAIL of $ITERS"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
