#!/usr/bin/env bash
set -euo pipefail

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"

for container in "$APP" "$POSTGRES"; do
  docker stop "$container" >/dev/null 2>&1 || true
done

if [[ "${JOB_AGENT_LOCAL_CLEANUP:-false}" == "true" ]]; then
  docker rm "$APP" "$POSTGRES" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
fi

echo "Job Agent local runtime stopped."
