#!/usr/bin/env bash
set -euo pipefail

APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"
NETWORK="${JOB_AGENT_LOCAL_NETWORK:-job-agent-local}"

for container in "$CONTENT" "$CONTACTS" "$RECRUITER" "$APP" "$POSTGRES"; do
  if docker inspect "$container" >/dev/null 2>&1; then
    docker stop "$container" >/dev/null
  fi
done

if [[ "${JOB_AGENT_LOCAL_CLEANUP:-false}" == "true" ]]; then
  for container in "$CONTENT" "$CONTACTS" "$RECRUITER" "$APP" "$POSTGRES"; do
    if docker inspect "$container" >/dev/null 2>&1; then docker rm "$container" >/dev/null; fi
  done
  if docker network inspect "$NETWORK" >/dev/null 2>&1; then docker network rm "$NETWORK" >/dev/null; fi
fi

echo "Job Agent local runtime stopped."
