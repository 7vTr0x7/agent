#!/usr/bin/env bash
set -euo pipefail

bash scripts/local-stop.sh
# Restart must preserve the PostgreSQL volume/container state. An explicit reset
# remains available through `JOB_AGENT_LOCAL_RESET=true npm run local:run`.
JOB_AGENT_LOCAL_RESET=false bash scripts/local-run.sh
