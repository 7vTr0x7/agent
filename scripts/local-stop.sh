#!/usr/bin/env bash
set -euo pipefail

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"

for container in "$APP" "$POSTGRES"; do
  if docker inspect "$container" >/dev/null 2>&1; then
    docker stop "$container" >/dev/null
  fi
done

if [[ "${JOB_AGENT_LOCAL_CLEANUP:-false}" == "true" ]]; then
  if docker inspect "$APP" >/dev/null 2>&1; then docker rm "$APP" >/dev/null; fi
  if docker inspect "$POSTGRES" >/dev/null 2>&1; then docker rm "$POSTGRES" >/dev/null; fi
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then docker network rm "$NETWORK" >/dev/null; fi
fi

echo "Job Agent local runtime stopped."
