#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Job Agent local runtime failed at line ${LINENO}." >&2' ERR

NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"
IMAGE="${JOB_AGENT_LOCAL_IMAGE:-job-agent:local}"
DB_NAME="${JOB_AGENT_LOCAL_DB:-job_agent}"
DB_USER="${JOB_AGENT_LOCAL_DB_USER:-job_agent}"
DB_PASSWORD="${JOB_AGENT_LOCAL_DB_PASSWORD:-local_runtime_password}"
API_PORT="${JOB_AGENT_LOCAL_API_PORT:-3000}"
ENRICHMENT_INTERVAL_MS="${ENRICHMENT_INTERVAL_MS:-900000}"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }

if ! [[ "$ENRICHMENT_INTERVAL_MS" =~ ^[0-9]+$ ]] || (( ENRICHMENT_INTERVAL_MS < 1000 )); then
  echo "ENRICHMENT_INTERVAL_MS must be an integer >= 1000 milliseconds." >&2
  exit 1
fi

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  docker network create "$NETWORK" >/dev/null
fi

remove_container() {
  local container="$1"
  if docker inspect "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null
  fi
}

if [[ "${JOB_AGENT_LOCAL_RESET:-false}" == "true" ]]; then
  remove_container "$CONTENT"
  remove_container "$CONTACTS"
  remove_container "$RECRUITER"
  remove_container "$APP"
  remove_container "$POSTGRES"
fi

# Recreate application-side workers on every local:run so a previous runtime cannot leave
# stale enrichment processes behind. The workers themselves use restart:unless-stopped.
remove_container "$CONTENT"
remove_container "$CONTACTS"
remove_container "$RECRUITER"

if ! docker inspect "$POSTGRES" >/dev/null 2>&1; then
  docker run -d --restart unless-stopped --name "$POSTGRES" --network "$NETWORK" \
    -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    postgres:17-alpine >/dev/null
fi

if ! docker network inspect "$NETWORK" --format '{{json .Containers}}' | grep -q '\"Name\":\"'"$POSTGRES"'\"'; then
  docker network connect "$NETWORK" "$POSTGRES" >/dev/null
fi
if [[ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES")" != "true" ]]; then
  docker start "$POSTGRES" >/dev/null
fi

ready=false
for i in $(seq 1 60); do
  if docker exec "$POSTGRES" psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q '^1$'; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "PostgreSQL did not finish initialization; container state and logs follow." >&2
  set +e
  docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}}' "$POSTGRES" >&2
  docker logs "$POSTGRES" >&2
  exit 1
fi

docker exec "$POSTGRES" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

docker build --tag "$IMAGE" .
remove_container "$APP"

docker run -d --restart unless-stopped --name "$APP" --network "$NETWORK" -p "${API_PORT}:3000" \
  -e NODE_ENV=production \
  -e LOG_LEVEL="${LOG_LEVEL:-info}" \
  -e DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD@$POSTGRES:5432/$DB_NAME" \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=3000 \
  -e AUTOMATION_ENABLED=false \
  -e APPLICATION_DRY_RUN=true \
  -e APPLICATION_LIVE_ENABLED=false \
  -e OUTBOUND_ENABLED=false \
  -e GMAIL_ENABLED=false \
  -e EMAIL_ENABLED=false \
  -e JOB_DISCOVERY_ENABLED=true \
  -e PROACTIVE_RECRUITER_ENABLED=true \
  -e PROACTIVE_RECRUITER_SEND_ENABLED=false \
  -e RECRUITER_OUTREACH_ENABLED=false \
  -e RECRUITER_OUTREACH_DRY_RUN=true \
  -e RECRUITER_OUTREACH_ACTIVATION=disabled \
  -e CANDIDATE_PROFILE_ID="${CANDIDATE_PROFILE_ID:-local-runtime-candidate}" \
  -e CANDIDATE_YEARS_EXPERIENCE="${CANDIDATE_YEARS_EXPERIENCE:-3}" \
  -e CANDIDATE_SKILLS="${CANDIDATE_SKILLS:-React,Next.js,TypeScript,JavaScript,Redux Toolkit,Node.js,Express,REST APIs,MongoDB,GraphQL,Tailwind,HTML,CSS}" \
  -e CANDIDATE_TARGET_TITLES="${CANDIDATE_TARGET_TITLES:-Frontend Engineer,Frontend Developer,React Developer,React/Next.js Developer,Full Stack Developer,Full Stack Engineer}" \
  -e CANDIDATE_LOCATION="${CANDIDATE_LOCATION:-India}" \
  -e CANDIDATE_PREFERRED_LOCATIONS="${CANDIDATE_PREFERRED_LOCATIONS:-Bengaluru,Bangalore,India,Remote}" \
  -e CANDIDATE_REMOTE_ELIGIBLE=true \
  -e CANDIDATE_NOTICE_PERIOD_DAYS=0 \
  -e CANDIDATE_SPONSORSHIP_REQUIRED=false \
  -e JOB_EXCLUDED_COMPANIES="${JOB_EXCLUDED_COMPANIES:-Octopus Technologies,Sketch Brahma Technologies}" \
  -e FAST_MATCHING_LIMIT="${FAST_MATCHING_LIMIT:-150}" \
  -e DISCOVERY_SOURCE_TIMEOUT_MS="${DISCOVERY_SOURCE_TIMEOUT_MS:-30000}" \
  -e DISCOVERY_SOURCE_RETRIES="${DISCOVERY_SOURCE_RETRIES:-1}" \
  -e APPLICATION_QUEUE_INTERVAL_MS="${APPLICATION_QUEUE_INTERVAL_MS:-30000}" \
  -e JOB_DISCOVERY_INTERVAL_MS="${JOB_DISCOVERY_INTERVAL_MS:-900000}" \
  -e OLLAMA_TIMEOUT_MS="${OLLAMA_TIMEOUT_MS:-250}" \
  "$IMAGE" node -e "require('./dist/api/bootstrap'); require('./dist/index')" >/dev/null

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then
  echo "Job Agent API did not become healthy; app logs follow." >&2
  set +e
  docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}}' "$APP" >&2
  docker logs "$APP" >&2
  exit 1
fi

COMMON_ENV=(
  -e "DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@$POSTGRES:5432/$DB_NAME"
  -e "CANDIDATE_PROFILE_ID=${CANDIDATE_PROFILE_ID:-local-runtime-candidate}"
  -e "CANDIDATE_YEARS_EXPERIENCE=${CANDIDATE_YEARS_EXPERIENCE:-3}"
  -e "CANDIDATE_SKILLS=${CANDIDATE_SKILLS:-React,Next.js,TypeScript,JavaScript,Redux Toolkit,Node.js,Express,REST APIs,MongoDB,GraphQL,Tailwind,HTML,CSS}"
  -e "CANDIDATE_TARGET_TITLES=${CANDIDATE_TARGET_TITLES:-Frontend Engineer,Frontend Developer,React Developer,React/Next.js Developer,Full Stack Developer,Full Stack Engineer}"
  -e "CANDIDATE_LOCATION=${CANDIDATE_LOCATION:-India}"
  -e "CANDIDATE_PREFERRED_LOCATIONS=${CANDIDATE_PREFERRED_LOCATIONS:-Bengaluru,Bangalore,India,Remote}"
  -e CANDIDATE_REMOTE_ELIGIBLE=true
  -e "ENRICHMENT_INTERVAL_MS=$ENRICHMENT_INTERVAL_MS"
  -e "PROACTIVE_RECRUITER_MAX_QUERIES=${PROACTIVE_RECRUITER_MAX_QUERIES:-8}"
  -e "PROACTIVE_RECRUITER_SEARCH_PROVIDERS=${PROACTIVE_RECRUITER_SEARCH_PROVIDERS:-bing-direct,google-direct,bing-jina,qwant-direct}"
  -e "PUBLIC_HIRING_POST_MAX_QUERIES=${PUBLIC_HIRING_POST_MAX_QUERIES:-8}"
  -e PROACTIVE_RECRUITER_ENABLED=true
  -e PROACTIVE_RECRUITER_SEND_ENABLED=false
)

start_enrichment_worker() {
  local name="$1"
  local mode="$2"
  docker run -d --restart unless-stopped --name "$name" --network "$NETWORK" \
    "${COMMON_ENV[@]}" \
    "$IMAGE" bash scripts/local-enrichment-loop.sh "$mode" >/dev/null
}

start_enrichment_worker "$RECRUITER" recruiter
start_enrichment_worker "$CONTACTS" contacts
start_enrichment_worker "$CONTENT" content

cat <<EOF
Job Agent local runtime is running.
Dashboard: http://127.0.0.1:${API_PORT}/
API summary: http://127.0.0.1:${API_PORT}/api/summary
App container: $APP
PostgreSQL container: $POSTGRES
Recruiter enrichment container: $RECRUITER
Contact enrichment container: $CONTACTS
Content enrichment container: $CONTENT
Enrichment interval: ${ENRICHMENT_INTERVAL_MS}ms
Logs: docker logs -f $APP
Recruiter enrichment log: docker logs -f $RECRUITER
Contact enrichment log: docker logs -f $CONTACTS
Content enrichment log: docker logs -f $CONTENT
Stop: npm run local:stop
Restart: npm run local:restart
Reset database: JOB_AGENT_LOCAL_RESET=true npm run local:run
EOF
