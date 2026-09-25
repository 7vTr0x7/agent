#!/usr/bin/env bash
set -euo pipefail

# Host-side one-shot runtime commands must execute in the same app container
# as the API/workers so they inherit the container's DATABASE_URL,
# CANDIDATE_PROFILE_ID, feature flags, and other runtime configuration.
# This also avoids assuming Docker Compose service names (the local setup
# intentionally uses stable container names).

SCRIPT="${1:-}"
if [[ -z "$SCRIPT" ]]; then
  echo "usage: $0 <script path> [args...]" >&2
  exit 2
fi
shift

run_script() {
  local script="$1"
  shift

  case "$script" in
    *.ts)
      exec npx --no-install tsx "$script" "$@"
      ;;
    *.js)
      exec node "$script" "$@"
      ;;
    *)
      echo "Unsupported runtime script: $script; expected .ts or .js" >&2
      exit 2
      ;;
  esac
}

if [[ -f /.dockerenv ]]; then
  run_script "$SCRIPT" "$@"
fi

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
if ! docker inspect "$APP" >/dev/null 2>&1; then
  echo "App container '$APP' was not found. Start the local runtime first with: npm run local:restart" >&2
  exit 1
fi

STATUS=""
if ! STATUS="$(docker inspect -f '{{.State.Status}}' "$APP" 2>/dev/null)"; then
  echo "Unable to determine the state of app container '$APP'." >&2
  exit 1
fi
if [[ "$STATUS" != "running" ]]; then
  echo "App container '$APP' is not running (status: ${STATUS:-unknown}). Start the local runtime first with: npm run local:restart" >&2
  exit 1
fi

# Pass the script as a positional argument to a non-login /bin/sh. Avoid
# embedding shell single quotes inside the single-quoted program: with
# `set -u`, that previously caused the host shell to expand $script and abort.
exec docker exec -i "$APP" /bin/sh -c '
  script="$1"
  shift
  case "$script" in
    *.ts) exec npx --no-install tsx "$script" "$@" ;;
    *.js) exec node "$script" "$@" ;;
    *) echo "Unsupported runtime script: $script; expected .ts or .js" >&2; exit 2 ;;
  esac
' "$APP" "$SCRIPT" "$@"
