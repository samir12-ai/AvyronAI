#!/usr/bin/env bash
# Seal #18 / Track #5 — lifecycle suite flake checker.
#
# Runs the full lifecycle scenario suite N times (default 100).
# Reports every failed iteration and prints the first failure log.
set -u

N="${N:-100}"
LOG_DIR="${LOG_DIR:-/tmp/lifecycle-flake}"
mkdir -p "$LOG_DIR"

passed=0
failed=0
failed_iters=()
total_start=$(date +%s)

for i in $(seq 1 "$N"); do
  log="$LOG_DIR/iter-$i.log"

  if npx vitest run server/tests/lifecycle/ >"$log" 2>&1; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    failed_iters+=("$i")
    echo "ITER $i FAILED — see $log" >&2

    # GitHub deletes /tmp after the job, so print the first real failure.
    if [ "$failed" -eq 1 ]; then
      echo "---------------- FIRST FAILURE LOG ----------------" >&2
      cat "$log" >&2
      echo "-------------- END FIRST FAILURE LOG --------------" >&2
    fi
  fi

  if [ $((i % 10)) -eq 0 ]; then
    echo "[lifecycle-flake-check] $i / $N — pass=$passed fail=$failed"
  fi
done

total_end=$(date +%s)
elapsed=$((total_end - total_start))

echo "------------------------------------------------------------"
echo "lifecycle-flake-check: $N iterations in ${elapsed}s"
echo "  pass: $passed"
echo "  fail: $failed"

if [ "$failed" -gt 0 ]; then
  echo "  failed iterations: ${failed_iters[*]}"
  exit 1
fi

echo "ALL ITERATIONS PASSED."
exit 0