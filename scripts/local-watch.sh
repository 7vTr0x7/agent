#!/usr/bin/env bash
set -euo pipefail

INTERVAL="${JOB_AGENT_LOCAL_WATCH_INTERVAL_SECONDS:-10}"
if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || (( INTERVAL < 1 )); then
  echo "JOB_AGENT_LOCAL_WATCH_INTERVAL_SECONDS must be a positive integer." >&2
  exit 1
fi

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"
API_PORT="${JOB_AGENT_LOCAL_API_PORT:-3000}"

status() {
  local container="$1"
  docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || printf 'not-found'
}

printf 'Watching Job Agent every %ss. Press Ctrl+C to stop watching (the runtime remains running).\n' "$INTERVAL"

while true; do
  printf '\n[%s]\n' "$(date -u +%FT%TZ)"
  printf 'app=%s postgres=%s recruiter=%s contacts=%s content=%s\n' \
    "$(status "$APP")" "$(status "$POSTGRES")" "$(status "$RECRUITER")" "$(status "$CONTACTS")" "$(status "$CONTENT")"

  if summary="$(curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/api/summary" 2>/dev/null)"; then
    printf '%s\n' "$summary"
  else
    echo 'API unavailable'
  fi

  sleep "$INTERVAL"
done
