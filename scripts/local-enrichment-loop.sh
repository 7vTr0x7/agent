#!/usr/bin/env bash
set -euo pipefail

MODE="${1:?usage: local-enrichment-loop.sh <recruiter|contacts|content>}"
INTERVAL_MS="${ENRICHMENT_INTERVAL_MS:-900000}"
COMMAND_TIMEOUT_SECONDS="${ENRICHMENT_COMMAND_TIMEOUT_SECONDS:-180}"

if ! [[ "$INTERVAL_MS" =~ ^[0-9]+$ ]] || (( INTERVAL_MS < 1000 )); then
  echo "ENRICHMENT_INTERVAL_MS must be an integer >= 1000 milliseconds." >&2
  exit 1
fi
if ! [[ "$COMMAND_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( COMMAND_TIMEOUT_SECONDS < 10 )); then
  echo "ENRICHMENT_COMMAND_TIMEOUT_SECONDS must be an integer >= 10 seconds." >&2
  exit 1
fi

SLEEP_SECONDS=$(( (INTERVAL_MS + 999) / 1000 ))

case "$MODE" in
  recruiter)
    COMMAND="npm run proactive-recruiter:once"
    LOG="/tmp/job-agent-proactive-recruiter.log"
    ;;
  contacts)
    COMMAND="npm run public-contact-resources:once"
    LOG="/tmp/job-agent-contact-resources.log"
    ;;
  content)
    COMMAND="npm run content-first:once"
    LOG="/tmp/job-agent-content.log"
    ;;
  *)
    echo "Unknown enrichment mode: $MODE" >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$LOG")"

echo "local enrichment worker started mode=$MODE intervalMs=$INTERVAL_MS sleepSeconds=$SLEEP_SECONDS commandTimeoutSeconds=$COMMAND_TIMEOUT_SECONDS"

echo "enrichment command log=$LOG"

while true; do
  started_at="$(date +%s)"
  if timeout --kill-after=10s "${COMMAND_TIMEOUT_SECONDS}s" bash -lc "$COMMAND" 2>&1 | tee -a "$LOG"; then
    finished_at="$(date +%s)"
    echo "$(date -u +%FT%TZ) enrichment cycle completed mode=$MODE durationSeconds=$((finished_at-started_at))" | tee -a "$LOG"
  else
    exit_code=${PIPESTATUS[0]}
    finished_at="$(date +%s)"
    if (( exit_code == 124 )); then
      echo "$(date -u +%FT%TZ) enrichment cycle timeout mode=$MODE durationSeconds=$((finished_at-started_at)) timeoutSeconds=$COMMAND_TIMEOUT_SECONDS" | tee -a "$LOG"
    else
      echo "$(date -u +%FT%TZ) enrichment cycle failed mode=$MODE exitCode=$exit_code durationSeconds=$((finished_at-started_at))" | tee -a "$LOG"
    fi
  fi
  sleep "$SLEEP_SECONDS"
done
