#!/bin/bash
set -e

# VERA CI Performance Validator
# Runs benchmarks and compares against baseline.json

BENCH_DIR="packages/bench"
BASELINE_FILE="$BENCH_DIR/baseline.json"
REPORT_FILE="$BENCH_DIR/bench-out/commit-rigorous/report-summary.json"

echo "=== VERA Performance Rigor Check ==="

run_and_validate() {
  DURABILITY=$1
  echo "Testing $DURABILITY durability..."
  
  if [ "$DURABILITY" == "strict" ]; then
    export VERA_BENCH_SYNC=true
  else
    export VERA_BENCH_SYNC=false
  fi
  
  NODE_OPTIONS="--expose-gc" pnpm --filter @vera/bench bench:commit
  
  # Parse baseline values
  TPS_MIN=$(jq -r ".$DURABILITY.tps_min" $BASELINE_FILE)
  P99_MAX=$(jq -r ".$DURABILITY.p99_max_ms" $BASELINE_FILE)
  
  # Parse actual values
  TPS_ACTUAL=$(jq -r ".summary.tps_mean" $REPORT_FILE)
  P99_ACTUAL=$(jq -r ".summary.latency_p99_avg" $REPORT_FILE)
  
  echo "Results for $DURABILITY:"
  echo "  TPS: $TPS_ACTUAL (Min: $TPS_MIN)"
  echo "  p99: $P99_ACTUAL (Max: $P99_MAX)"
  
  if (( $(echo "$TPS_ACTUAL < $TPS_MIN" | bc -l) )); then
    echo "ERROR: TPS regression detected!"
    exit 1
  fi
  
  if (( $(echo "$P99_ACTUAL > $P99_MAX" | bc -l) )); then
    echo "ERROR: p99 latency regression detected!"
    exit 1
  fi
  
  echo "SUCCESS: $DURABILITY within baseline."
}

# Ensure jq is available
if ! command -v jq &> /dev/null; then
    echo "jq command not found. Please install it."
    exit 1
fi

# Ensure bc is available
if ! command -v bc &> /dev/null; then
    echo "bc command not found. Please install it."
    exit 1
fi

run_and_validate "logical"
run_and_validate "strict"

echo "=== All performance checks PASSED ==="
