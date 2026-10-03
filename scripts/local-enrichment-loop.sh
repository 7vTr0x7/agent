#!/usr/bin/env bash
set -euo pipefail

MODE="${1:?usage: local-enrichment-loop.sh <recruiter|contacts|content>}"
INTERVAL_MS="${ENRICHMENT_INTERVAL_MS:-900000}"
# Public contact discovery is intentionally bounded but can legitimately take
# longer than recruiter/content enrichment because it validates multiple public
# source pages. Keep the per-cycle cap finite while avoiding false TIMED_OUT
# states during the real-data acceptance run.
#
# Contacts execute several independent public-resource passes (downloadable
# files, LinkedIn hiring-post resources, resource promotion, recruiter contact
# promotion, job-linked supplements, and reconciliation). Give that pipeline a
# separate default budget so real-data latency does not get mistaken for a
# worker failure. The generic override remains available for local/CI tuning.
case "$MODE" in
  contacts)
    COMMAND_TIMEOUT_SECONDS="${ENRICHMENT_CONTACT_COMMAND_TIMEOUT_SECONDS:-900}"
    ;;
  *)
    COMMAND_TIMEOUT_SECONDS="${ENRICHMENT_COMMAND_TIMEOUT_SECONDS:-300}"
    ;;
esac
STATE_DIR="${ENRICHMENT_STATE_DIR:-/tmp/job-agent-enrichment}"

if ! [[ "$INTERVAL_MS" =~ ^[0-9]+$ ]] || (( INTERVAL_MS < 1000 )); then
  echo "ENRICHMENT_INTERVAL_MS must be an integer >= 1000 milliseconds." >&2
  exit 1
fi
if ! [[ "$COMMAND_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( COMMAND_TIMEOUT_SECONDS < 10 )); then
  echo "Enrichment command timeout must be an integer >= 10 seconds." >&2
  exit 1
fi

SLEEP_SECONDS=$(( (INTERVAL_MS + 999) / 1000 ))

case "$MODE" in
  recruiter)
    COMMAND="npm run proactive-recruiter:once"
    LOG="/tmp/job-agent-proactive-recruiter.log"
    ;;
  contacts)
    COMMAND="npm run public-contact-files:once && npm run public-contact-resources:once && ./node_modules/.bin/tsx scripts/reconcile-public-contact-resources-once.ts"
    LOG="/tmp/job-agent-contact-resources.log"
    ;;
  content)
    COMMAND="npm run content-first:once"
    LOG="/tmp/job-agent-content.log"
    ;;
  *)
    echo "Unknown enrichment mode: $MODE" >&2
    exit 1
    ;;
esac

# The local runtime historically restricted recruiter search to direct search-engine
# pages. Those pages are commonly rate-limited or anti-bot protected even when the
# same public query is available through the bounded Jina reader/search paths.
# Keep the existing direct providers, but add the resilient public representations.
if [[ "$MODE" == "recruiter" ]]; then
  PROACTIVE_RECRUITER_SEARCH_PROVIDERS="${PROACTIVE_RECRUITER_SEARCH_PROVIDERS:-}"
  for provider in bing-jina google-jina jina-search duckduckgo-jina; do
    case ",$PROACTIVE_RECRUITER_SEARCH_PROVIDERS," in
      *",$provider,"*) ;;
      *) PROACTIVE_RECRUITER_SEARCH_PROVIDERS="${PROACTIVE_RECRUITER_SEARCH_PROVIDERS:+$PROACTIVE_RECRUITER_SEARCH_PROVIDERS,}$provider" ;;
    esac
  done
  export PROACTIVE_RECRUITER_SEARCH_PROVIDERS
fi

source "$(dirname "$0")/local-enrichment-cycle.sh"
mkdir -p "$(dirname "$LOG")" "$STATE_DIR"
write_enrichment_state "$MODE" "STARTED" "" 0 "$(date -u +%FT%TZ)" "" 0 0 "$COMMAND_TIMEOUT_SECONDS"

echo "local enrichment worker started mode=$MODE intervalMs=$INTERVAL_MS sleepSeconds=$SLEEP_SECONDS commandTimeoutSeconds=$COMMAND_TIMEOUT_SECONDS"
echo "enrichment command log=$LOG"
echo "enrichment lifecycle state=$STATE_DIR/$MODE.json"
echo "recruiter search providers=${PROACTIVE_RECRUITER_SEARCH_PROVIDERS:-default}"

while true; do
  if ! run_enrichment_cycle "$MODE" "$COMMAND" "$LOG" "$COMMAND_TIMEOUT_SECONDS"; then
    echo "enrichment cycle failed mode=$MODE; continuing scheduled worker loop" >&2
  fi
  sleep "$SLEEP_SECONDS"
done
