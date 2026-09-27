#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-docker}"
STATE_DIR="${ENRICHMENT_STATE_DIR:-/tmp/job-agent-enrichment}"
STARTUP_WAIT_SECONDS="${ENRICHMENT_STARTUP_WAIT_SECONDS:-60}"
CONTAINERS=(job-agent-local-recruiter job-agent-local-contacts job-agent-local-content)

read_state() {
  local container="$1"
  "$DOCKER_BIN" exec "$container" sh -lc "cat '$STATE_DIR/${container#job-agent-local-}.json'" 2>/dev/null || true
}

for container in "${CONTAINERS[@]}"; do
  startup_deadline=$((SECONDS+STARTUP_WAIT_SECONDS))
  while true; do
    test "$("$DOCKER_BIN" inspect -f '{{.State.Status}}' "$container")" = running
    state="$(read_state "$container")"
    if [[ -z "$state" ]]; then
      echo "$container lifecycle=STARTING state=missing"
      if (( SECONDS >= startup_deadline )); then
        echo "$container never exposed lifecycle state" >&2
        exit 1
      fi
      sleep 5
      continue
    fi

    status="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(s.status||""))' "$state")"
    case "$status" in
      COMPLETED)
        echo "$container lifecycle=COMPLETED state=$state"
        break
        ;;
      FAILED|TIMED_OUT)
        echo "$container lifecycle=$status state=$state"
        exit 1
        ;;
      STARTED)
        echo "$container lifecycle=STARTED"
        if (( SECONDS >= startup_deadline )); then
          echo "$container remained STARTED without beginning a cycle" >&2
          exit 1
        fi
        ;;
      RUNNING)
        timeout_seconds="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(Number(s.timeoutSeconds)||0))' "$state")"
        started_epoch="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(Number(s.startedEpoch)||0))' "$state")"
        if (( timeout_seconds <= 0 || started_epoch <= 0 )); then
          echo "$container has invalid RUNNING lifecycle state: $state" >&2
          exit 1
        fi
        terminal_deadline=$((started_epoch+timeout_seconds+15))
        echo "$container lifecycle=RUNNING timeoutSeconds=$timeout_seconds"
        if (( $(date +%s) >= terminal_deadline )); then
          echo "$container remained RUNNING beyond its configured timeout window" >&2
          exit 1
        fi
        ;;
      *)
        echo "$container lifecycle=UNKNOWN state=$state" >&2
        exit 1
        ;;
    esac
    sleep 5
  done
done

# The worker lifecycle gate deliberately verifies execution only. Persisted
# record counts are checked after the workers have completed, by the runtime
# acceptance/API/database gates. This avoids racing an asynchronous worker's
# first cycle while still failing on an actual worker lifecycle error.
curl --fail --silent "$API_BASE/api/summary" >/tmp/enrichment-worker-final-summary.json 2>/dev/null || true
