#!/usr/bin/env bash
set -euo pipefail

POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
DB_PORT="${JOB_AGENT_LOCAL_DB_PORT:-5432}"

# The application containers use Docker-network PostgreSQL directly. This helper
# only repairs host-side access used by local diagnostics/tests; it never resets
# the database or deletes its persistent volume.
if ! docker inspect "$POSTGRES" >/dev/null 2>&1; then
  exit 0
fi

host_binding="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$POSTGRES")"
if [[ "$host_binding" == *"0.0.0.0:${DB_PORT}"* || "$host_binding" == *"127.0.0.1:${DB_PORT}"* || "$host_binding" == *":::${DB_PORT}"* ]]; then
  exit 0
fi

if docker ps -q --filter "publish=${DB_PORT}" | grep -q .; then
  owner="$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}' | head -n 1)"
  echo "PostgreSQL host port ${DB_PORT} is already owned by ${owner}; refusing to stop an unrelated service." >&2
  exit 1
fi

IMAGE="$(docker inspect -f '{{.Config.Image}}' "$POSTGRES")"
NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$POSTGRES" | head -n 1)"
VOLUME_SOURCE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' "$POSTGRES")"
POSTGRES_DB="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$POSTGRES" | sed -n 's/^POSTGRES_DB=//p' | head -n 1)"
POSTGRES_USER="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$POSTGRES" | sed -n 's/^POSTGRES_USER=//p' | head -n 1)"
POSTGRES_PASSWORD="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$POSTGRES" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -n 1)"

[[ -n "$NETWORK" ]] || { echo "Cannot determine PostgreSQL Docker network." >&2; exit 1; }
[[ -n "$VOLUME_SOURCE" ]] || { echo "Cannot determine PostgreSQL data mount; refusing to recreate the container." >&2; exit 1; }
[[ -n "$POSTGRES_DB" && -n "$POSTGRES_USER" && -n "$POSTGRES_PASSWORD" ]] || { echo "Cannot recover PostgreSQL credentials from the existing container." >&2; exit 1; }

RUNNING="$(docker inspect -f '{{.State.Running}}' "$POSTGRES")"

echo "Repairing PostgreSQL host access without resetting data: ${POSTGRES} -> 127.0.0.1:${DB_PORT}." >&2

docker rm -f "$POSTGRES" >/dev/null

docker run -d --restart unless-stopped --name "$POSTGRES" --network "$NETWORK" \
  -p "${DB_PORT}:5432" \
  -v "$VOLUME_SOURCE:/var/lib/postgresql/data" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  "$IMAGE" >/dev/null

if [[ "$RUNNING" != "true" ]]; then
  docker stop "$POSTGRES" >/dev/null
fi

echo "PostgreSQL host access restored on 127.0.0.1:${DB_PORT}; persistent data was preserved." >&2
