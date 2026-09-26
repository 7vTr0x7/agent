#!/usr/bin/env bash
set -euo pipefail

write_enrichment_state() {
  local state_dir="${ENRICHMENT_STATE_DIR:-/tmp/job-agent-enrichment}"
  local mode="$1" status="$2" cycle_id="$3" started_epoch="$4" started_at="$5" finished_at="$6" duration="$7" exit_code="$8" timeout_seconds="$9"
  local state_file="$state_dir/$mode.json"
  local tmp_file="$state_file.tmp.$$"
  mkdir -p "$state_dir"
  printf '{"mode":"%s","status":"%s","cycleId":"%s","startedEpoch":%s,"startedAt":"%s","finishedAt":"%s","durationSeconds":%s,"exitCode":%s,"timeoutSeconds":%s,"workerPid":%s}\n' \
    "$mode" "$status" "$cycle_id" "$started_epoch" "$started_at" "$finished_at" "$duration" "$exit_code" "$timeout_seconds" "$$" > "$tmp_file"
  mv "$tmp_file" "$state_file"
}

run_enrichment_cycle() {
  local mode="$1" command="$2" log="$3" timeout_seconds="$4"
  local cycle_id started_epoch finished_epoch duration exit_code status
  cycle_id="$(date -u +%Y%m%dT%H%M%S%NZ)-$$"
  started_epoch="$(date +%s)"
  write_enrichment_state "$mode" "RUNNING" "$cycle_id" "$started_epoch" "$(date -u +%FT%TZ)" "" 0 0 "$timeout_seconds"

  if timeout --kill-after=10s "${timeout_seconds}s" bash -lc "$command" 2>&1 | tee -a "$log"; then
    exit_code=0
    status="COMPLETED"
  else
    exit_code=${PIPESTATUS[0]}
    if (( exit_code == 124 )); then
      status="TIMED_OUT"
    else
      status="FAILED"
    fi
  fi

  finished_epoch="$(date +%s)"
  duration=$((finished_epoch-started_epoch))
  write_enrichment_state "$mode" "$status" "$cycle_id" "$started_epoch" "$(date -u -d "@$started_epoch" +%FT%TZ)" "$(date -u +%FT%TZ)" "$duration" "$exit_code" "$timeout_seconds"
  return "$exit_code"
}
