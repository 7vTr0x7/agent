#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-docker}"
STATE_DIR="${ENRICHMENT_STATE_DIR:-/tmp/job-agent-enrichment}"
STARTUP_WAIT_SECONDS="${ENRICHMENT_STARTUP_WAIT_SECONDS:-60}"
PERSISTENCE_WAIT_SECONDS="${ENRICHMENT_PERSISTENCE_WAIT_SECONDS:-120}"
API_BASE="${JOB_AGENT_LOCAL_API_BASE:-http://127.0.0.1:${JOB_AGENT_LOCAL_API_PORT:-3100}}"
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

# Worker lifecycle completion is not sufficient evidence that the three
# independently scheduled workers have converged into persisted API state.
# The contacts worker can complete its first cycle before the recruiter worker
# has produced a candidate. Wait for persisted records before the final
# runtime aggregate snapshots the database. This only observes live state.
persistence_deadline=$((SECONDS+PERSISTENCE_WAIT_SECONDS))
while true; do
  summary="$(curl --fail --silent "$API_BASE/api/summary")"
  recruiters="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(Number(s.recruiters)||0))' "$summary")"
  contacts="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(Number(s.contacts)||0))' "$summary")"
  content="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(String(Number(s.content)||0))' "$summary")"
  echo "enrichment persisted recruiters=$recruiters contacts=$contacts content=$content"
  if (( recruiters > 0 && contacts > 0 && content > 0 )); then
    break
  fi
  if (( SECONDS >= persistence_deadline )); then
    echo "enrichment workers completed but persisted state did not converge: $summary" >&2
    exit 1
  fi
  sleep 5
done
