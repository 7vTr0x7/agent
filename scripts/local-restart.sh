#!/usr/bin/env bash
set -euo pipefail

POSTGRES="${JOB_AGENT_LOCAL_POSTGRES:-job-agent-local-postgres}"
APP="${JOB_AGENT_LOCAL_APP:-job-agent-local-app}"
RECRUITER="${JOB_AGENT_LOCAL_RECRUITER:-job-agent-local-recruiter}"
CONTACTS="${JOB_AGENT_LOCAL_CONTACTS:-job-agent-local-contacts}"
CONTENT="${JOB_AGENT_LOCAL_CONTENT:-job-agent-local-content}"

# A restart is a process/container restart, not a database reset. Keep PostgreSQL
# running so its existing data remains attached to the same persistent volume.
if docker inspect "$POSTGRES" >/dev/null 2>&1; then
  if [[ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES")" != "true" ]]; then
    docker start "$POSTGRES" >/dev/null
  fi
fi

# Recreate application-side processes so the runtime reconnects cleanly while the
# PostgreSQL container and its data remain untouched.
for container in "$CONTENT" "$CONTACTS" "$RECRUITER" "$APP"; do
  if docker inspect "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null
  fi
done

JOB_AGENT_LOCAL_RESET=false JOB_AGENT_LOCAL_CLEANUP=false bash scripts/local-run.sh
