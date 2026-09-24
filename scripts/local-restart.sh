#!/usr/bin/env bash
set -euo pipefail

bash scripts/local-stop.sh
exec bash scripts/local-run.sh
