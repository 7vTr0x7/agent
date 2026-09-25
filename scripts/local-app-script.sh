#!/usr/bin/env bash
set -euo pipefail

# Host-side one-shot runtime commands must execute in the same app container
# as the API/workers so they inherit the container's DATABASE_URL,
# CANDIDATE_PROFILE_ID, feature flags, and other runtime configuration.
# This also avoids assuming Docker Compose service names (the local setup
# intentionally uses stable container names).

SCRIPT="${1:-}"
if [[ -z "$SCRIPT" ]]; then
  echo "usage: $0 <dist script path> [args...]" >&2
  exit 2
fi
shift || true

if [[ -f /.dockerenv ]]; then
  exec node "$SCRIPT" "$@"
fi

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
if ! docker inspect "$APP" >/dev/null 2>&1; then
  echo "App container '$APP' was not found. Start the local runtime first with: npm run local:restart" >&2
  exit 1
fi

STATUS="$(docker inspect -f '{{.State.Status}}' "$APP" 2>/dev/null || true)"
if [[ "$STATUS" != "running" ]]; then
  echo "App container '$APP' is not running (status: ${STATUS:-unknown}). Start the local runtime first with: npm run local:restart" >&2
  exit 1
fi

exec docker exec -i "$APP" node "$SCRIPT" "$@"
