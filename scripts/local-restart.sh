#!/usr/bin/env bash
set -euo pipefail

POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"
NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"
API_PORT="${JOB_AGENT_LOCAL_API_PORT:-3000}"

# A restart is a process/container restart, not a database reset. Keep PostgreSQL
# running so its existing data remains attached to the same persistent volume.
if docker inspect "$POSTGRES" >/dev/null 2>&1; then
  if [[ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES")" != "true" ]]; then
    docker start "$POSTGRES" >/dev/null
  fi
fi

# The normal Docker Compose stack is also a supported local runtime. If its app
# currently owns port 3000, adopt its existing PostgreSQL container/network for
# the feature-complete local runtime instead of treating the compose app as an
# unrelated service or silently switching to a fresh empty database.
COMPOSE_APP="$(docker ps -q \
  --filter 'label=com.docker.compose.service=app' \
  --filter 'label=com.docker.compose.project=job-agent' | head -n 1)"
if [[ -n "$COMPOSE_APP" ]]; then
  COMPOSE_POSTGRES="$(docker ps -q \
    --filter 'label=com.docker.compose.service=postgres' \
    --filter 'label=com.docker.compose.project=job-agent' | head -n 1)"
  if [[ -n "$COMPOSE_POSTGRES" ]]; then
    COMPOSE_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$COMPOSE_APP" | head -n 1)"
    if [[ -n "$COMPOSE_NETWORK" ]]; then
      NETWORK="$COMPOSE_NETWORK"
    fi
    POSTGRES="$(docker inspect -f '{{.Name}}' "$COMPOSE_POSTGRES" | sed 's#^/##')"

    # Preserve the compose runtime's database/profile configuration. This keeps
    # local:restart on the same real local data rather than creating a second DB.
    while IFS='=' read -r key value; do
      case "$key" in
        POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD)
          export "${key}=${value}"
          ;;
      esac
    done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$COMPOSE_POSTGRES")

    while IFS='=' read -r key value; do
      case "$key" in
        CANDIDATE_PROFILE_ID|CANDIDATE_YEARS_EXPERIENCE|CANDIDATE_SKILLS|CANDIDATE_TARGET_TITLES|CANDIDATE_FIRST_NAME|CANDIDATE_LAST_NAME|CANDIDATE_FULL_NAME|CANDIDATE_EMAIL|CANDIDATE_PHONE|CANDIDATE_LOCATION|CANDIDATE_WORK_AUTHORIZATION|CANDIDATE_SPONSORSHIP_REQUIRED|CANDIDATE_NOTICE_PERIOD_DAYS|CANDIDATE_LINKEDIN_URL|CANDIDATE_GITHUB_URL|CANDIDATE_PORTFOLIO_URL|CANDIDATE_RESUME_PATH)
          export "${key}=${value}"
          ;;
      esac
    done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$COMPOSE_APP")

    echo "Adopting Docker Compose PostgreSQL/network for the local feature-complete runtime: ${POSTGRES} on ${NETWORK}." >&2
    docker rm -f "$COMPOSE_APP" >/dev/null
  fi
fi

# Recreate application-side processes so the runtime reconnects cleanly while the
# PostgreSQL container and its data remain untouched.
for container in "$CONTENT" "$CONTACTS" "$RECRUITER" "$APP"; do
  if docker inspect "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null
  fi
done

# Recover from an interrupted/duplicate local runtime that still owns the API
# port. Only reclaim containers belonging to this Job Agent local runtime; never
# kill an unrelated service that happens to use the same host port.
while IFS= read -r container_id; do
  [[ -z "$container_id" ]] && continue
  container_name="$(docker inspect -f '{{.Name}}' "$container_id" 2>/dev/null | sed 's#^/##')"
  case "$container_name" in
    "$APP"|job-agent-local-*)
      docker rm -f "$container_id" >/dev/null
      ;;
    *)
      echo "Port ${API_PORT} is already owned by unrelated container ${container_name}. Stop it or set JOB_AGENT_LOCAL_API_PORT to a free port." >&2
      exit 1
      ;;
  esac
done < <(docker ps -q --filter "publish=${API_PORT}")

# The local runner keeps external side effects disabled, but these runtime-quality
# defaults can be overridden by the caller without changing the safety boundary.
export OLLAMA_TIMEOUT_MS="${OLLAMA_TIMEOUT_MS:-15000}"
export DISCOVERY_SOURCE_TIMEOUT_MS="${DISCOVERY_SOURCE_TIMEOUT_MS:-180000}"
export DISCOVERY_SOURCE_RETRIES="${DISCOVERY_SOURCE_RETRIES:-0}"
export DISCOVERY_FEDERATION_TIMEOUT_MS="${DISCOVERY_FEDERATION_TIMEOUT_MS:-1800000}"
export PLATFORM_SEARCH_CONCURRENCY="${PLATFORM_SEARCH_CONCURRENCY:-16}"
export PLATFORM_ITEM_TIMEOUT_MS="${PLATFORM_ITEM_TIMEOUT_MS:-45000}"
export ENRICHMENT_COMMAND_TIMEOUT_SECONDS="${ENRICHMENT_COMMAND_TIMEOUT_SECONDS:-300}"

JOB_AGENT_LOCAL_NETWORK="$NETWORK" JOB_AGENT_LOCAL_POSTGRES="$POSTGRES" JOB_AGENT_LOCAL_RESET=false JOB_AGENT_LOCAL_CLEANUP=false bash scripts/local-run.sh
