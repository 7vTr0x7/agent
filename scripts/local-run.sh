#!/usr/bin/env bash
set -euo pipefail

NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
IMAGE="${JOB_AGENT_LOCAL_IMAGE:-job-agent:local}"
DB_NAME="${JOB_AGENT_LOCAL_DB:-job_agent}"
DB_USER="${JOB_AGENT_LOCAL_DB_USER:-job_agent}"
DB_PASSWORD="${JOB_AGENT_LOCAL_DB_PASSWORD:-local_runtime_password}"

cleanup() {
  if [[ "${JOB_AGENT_LOCAL_CLEANUP:-false}" == "true" ]]; then
    docker rm -f "$POSTGRES" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker rm -f "$POSTGRES" >/dev/null 2>&1 || true
docker run -d --name "$POSTGRES" --network "$NETWORK" \
  -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  postgres:17-alpine >/dev/null

for i in $(seq 1 60); do
  if docker exec "$POSTGRES" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$POSTGRES" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

docker build --tag "$IMAGE" .

docker run --rm --network "$NETWORK" \
  -e NODE_ENV=test \
  -e LOG_LEVEL="${LOG_LEVEL:-info}" \
  -e DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD@$POSTGRES:5432/$DB_NAME" \
  -e AUTOMATION_ENABLED=false \
  -e APPLICATION_DRY_RUN=true \
  -e APPLICATION_LIVE_ENABLED=false \
  -e OUTBOUND_ENABLED=false \
  -e GMAIL_ENABLED=false \
  -e EMAIL_ENABLED=false \
  -e JOB_DISCOVERY_ENABLED=true \
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
  -e FAST_JOB_SOURCE_IDS="${FAST_JOB_SOURCE_IDS:-remoteok:json,himalayas:react:india:json,himalayas:nextjs:india:json,himalayas:frontend:india:json,remotefirstjobs:react:rss}" \
  -e FAST_MATCHING_LIMIT="${FAST_MATCHING_LIMIT:-150}" \
  -e DISCOVERY_SOURCE_TIMEOUT_MS="${DISCOVERY_SOURCE_TIMEOUT_MS:-30000}" \
  -e DISCOVERY_SOURCE_RETRIES="${DISCOVERY_SOURCE_RETRIES:-1}" \
  -e RECRUITER_OUTREACH_ENABLED=false \
  -e APPLICATION_QUEUE_INTERVAL_MS=1000 \
  -e OLLAMA_TIMEOUT_MS="${OLLAMA_TIMEOUT_MS:-250}" \
  "$IMAGE" npm run outcome:fast-jobs

echo
echo "Local runtime completed. PostgreSQL is still running in container: $POSTGRES"
echo "Inspect jobs:"
echo "  docker exec -it $POSTGRES psql -U $DB_USER -d $DB_NAME"
echo "Set JOB_AGENT_LOCAL_CLEANUP=true to remove the local runtime database on exit."
