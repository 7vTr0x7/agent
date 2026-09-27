#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/local-enrichment-cycle.sh"

run_case() {
  local name="$1" command="$2" timeout_seconds="$3" expected="$4"
  local state_dir="$(mktemp -d)"
  local log="$state_dir/$name.log"
  export ENRICHMENT_STATE_DIR="$state_dir"
  set +e
  run_enrichment_cycle "$name" "$command" "$log" "$timeout_seconds"
  local rc=$?
  set -e
  local state status
  state="$(cat "$state_dir/$name.json")"
  status="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(s.status)' "$state")"
  [[ "$status" == "$expected" ]] || { echo "expected $expected, got $status: $state" >&2; exit 1; }
  case "$expected" in
    COMPLETED) [[ "$rc" -eq 0 ]] || { echo "completed cycle returned $rc" >&2; exit 1; } ;;
    FAILED|TIMED_OUT) [[ "$rc" -ne 0 ]] || { echo "$expected cycle returned success" >&2; exit 1; } ;;
  esac
  rm -rf "$state_dir"
  echo "PASS lifecycle $name -> $status"
}

run_running_case() {
  local state_dir="$(mktemp -d)" log
  log="$state_dir/delayed-success.log"
  export ENRICHMENT_STATE_DIR="$state_dir"
  set +e
  run_enrichment_cycle delayed-success 'sleep 7' "$log" 10 &
  local pid=$!
  set -e
  for _ in $(seq 1 20); do
    if [[ -f "$state_dir/delayed-success.json" ]]; then break; fi
    sleep 0.2
  done
  local state status
  state="$(cat "$state_dir/delayed-success.json")"
  status="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(s.status)' "$state")"
  if [[ "$status" != "RUNNING" ]]; then
    echo "expected RUNNING during delayed cycle, got $status: $state" >&2
    if kill "$pid" 2>/dev/null; then :; fi
    exit 1
  fi
  wait "$pid"; local rc=$?
  [[ "$rc" -eq 0 ]] || { echo "delayed cycle returned $rc" >&2; exit 1; }
  state="$(cat "$state_dir/delayed-success.json")"
  status="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(s.status)' "$state")"
  [[ "$status" == "COMPLETED" ]] || { echo "expected COMPLETED after delayed cycle, got $status" >&2; exit 1; }
  rm -rf "$state_dir"
  echo "PASS lifecycle RUNNING->COMPLETED after verification interval"
}

run_verifier_case() {
  local name="$1" final_status="$2" expected_rc="$3"
  local state_dir="$(mktemp -d)"
  local fake_bin="$state_dir/fake-docker"
  for mode in recruiter contacts content; do
    printf '{"mode":"%s","status":"%s","cycleId":"test-%s","startedEpoch":%s,"startedAt":"2026-09-27T00:00:00Z","finishedAt":"","durationSeconds":0,"exitCode":0,"timeoutSeconds":10,"workerPid":1}\n' "$mode" "$final_status" "$mode" "$(date +%s)" > "$state_dir/$mode.json"
  done
  cat > "$fake_bin" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  inspect) echo running ;;
  exec) container="$2"; mode="${container#job-agent-local-}"; cat "$ENRICHMENT_STATE_DIR/$mode.json" ;;
  *) exit 2 ;;
esac
FAKE
  chmod +x "$fake_bin"
  set +e
  DOCKER_BIN="$fake_bin" ENRICHMENT_STATE_DIR="$state_dir" ENRICHMENT_STARTUP_WAIT_SECONDS=1 "$ROOT/verify-enrichment-workers.sh" >/tmp/verifier.out 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne "$expected_rc" ]]; then cat /tmp/verifier.out; echo "expected verifier rc=$expected_rc, got $rc" >&2; exit 1; fi
  if [[ "$final_status" == COMPLETED ]]; then grep -q 'lifecycle=COMPLETED' /tmp/verifier.out || { cat /tmp/verifier.out; exit 1; }; fi
  if [[ "$final_status" == FAILED ]]; then grep -q 'lifecycle=FAILED' /tmp/verifier.out || { cat /tmp/verifier.out; exit 1; }; fi
  if [[ "$final_status" == TIMED_OUT ]]; then grep -q 'lifecycle=TIMED_OUT' /tmp/verifier.out || { cat /tmp/verifier.out; exit 1; }; fi
  rm -rf "$state_dir"
  echo "PASS acceptance $name -> $final_status rc=$rc"
}

run_verifier_running_case() {
  local state_dir="$(mktemp -d)"
  local fake_bin="$state_dir/fake-docker"
  for mode in recruiter contacts content; do
    printf '{"mode":"%s","status":"RUNNING","cycleId":"test-%s","startedEpoch":%s,"startedAt":"2026-09-27T00:00:00Z","finishedAt":"","durationSeconds":0,"exitCode":0,"timeoutSeconds":10,"workerPid":1}\n' "$mode" "$mode" "$(date +%s)" > "$state_dir/$mode.json"
  done
  cat > "$fake_bin" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  inspect) echo running ;;
  exec) container="$2"; mode="${container#job-agent-local-}"; cat "$ENRICHMENT_STATE_DIR/$mode.json" ;;
  *) exit 2 ;;
esac
FAKE
  chmod +x "$fake_bin"
  (
    sleep 7
    for mode in recruiter contacts content; do
      sed -i 's/"status":"RUNNING"/"status":"COMPLETED"/' "$state_dir/$mode.json"
    done
  ) &
  local updater=$!
  set +e
  DOCKER_BIN="$fake_bin" ENRICHMENT_STATE_DIR="$state_dir" ENRICHMENT_STARTUP_WAIT_SECONDS=1 "$ROOT/verify-enrichment-workers.sh" >/tmp/verifier-running.out 2>&1
  local rc=$?
  set -e
  wait "$updater"
  [[ "$rc" -eq 0 ]] || { cat /tmp/verifier-running.out; echo "expected delayed acceptance rc=0, got $rc" >&2; exit 1; }
  grep -q 'lifecycle=RUNNING' /tmp/verifier-running.out || { cat /tmp/verifier-running.out; exit 1; }
  grep -q 'lifecycle=COMPLETED' /tmp/verifier-running.out || { cat /tmp/verifier-running.out; exit 1; }
  rm -rf "$state_dir"
  echo 'PASS acceptance RUNNING->COMPLETED after verification interval'
}

run_case command-success 'true' 5 COMPLETED
run_running_case
run_case command-failure 'exit 7' 5 FAILED
run_case configured-timeout 'sleep 3' 1 TIMED_OUT
run_verifier_running_case
run_verifier_case acceptance-pass COMPLETED 0
run_verifier_case acceptance-failure FAILED 1
run_verifier_case acceptance-timeout TIMED_OUT 1

echo 'PASS local enrichment lifecycle regression suite'
