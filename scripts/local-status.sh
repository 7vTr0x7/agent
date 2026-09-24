#!/usr/bin/env bash
set -euo pipefail

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"
API_PORT="${JOB_AGENT_LOCAL_API_PORT:-3000}"

for pair in \
  "App container:$APP" \
  "PostgreSQL container:$POSTGRES" \
  "Recruiter enrichment:$RECRUITER" \
  "Contact enrichment:$CONTACTS" \
  "Content enrichment:$CONTENT"; do
  label="${pair%%:*}"
  container="${pair#*:}"
  printf '%s: ' "$label"
  docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo 'not found'
done

if curl -fsS "http://127.0.0.1:${API_PORT}/healthz"; then
  echo
  echo 'Summary:'
  curl -fsS "http://127.0.0.1:${API_PORT}/api/summary"
  echo
else
  echo 'API: unavailable'
  exit 1
fi
