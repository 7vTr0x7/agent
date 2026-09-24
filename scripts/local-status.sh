#!/usr/bin/env bash
set -euo pipefail

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
API_PORT="${JOB_AGENT_LOCAL_API_PORT:-3000}"

printf 'App container: '
docker inspect -f '{{.State.Status}}' "$APP" 2>/dev/null || echo 'not found'
printf 'PostgreSQL container: '
docker inspect -f '{{.State.Status}}' "$POSTGRES" 2>/dev/null || echo 'not found'

if curl -fsS "http://127.0.0.1:${API_PORT}/healthz"; then
  echo
  echo 'Summary:'
  curl -fsS "http://127.0.0.1:${API_PORT}/api/summary"
  echo
else
  echo 'API: unavailable'
  exit 1
fi
