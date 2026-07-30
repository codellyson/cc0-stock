#!/usr/bin/env sh
# Batch backfill: ingest every query in queries.txt (one phrase per line, # = comment).
# Loads config from .env. Env overrides: PAGES, PAGESIZE, SOURCE, CONCURRENCY.
#
#   ./run.sh                 # uses queries.txt
#   ./run.sh my-queries.txt  # a different list
set -eu
cd "$(dirname "$0")"

[ -f .env ] || { echo "error: .env not found (cp .env.example .env and fill it in)" >&2; exit 1; }
set -a; . ./.env; set +a

QFILE="${1:-queries.txt}"
[ -f "$QFILE" ] || { echo "error: queries file '$QFILE' not found" >&2; exit 1; }

PAGES="${PAGES:-3}"
PAGESIZE="${PAGESIZE:-20}"
SOURCE="${SOURCE:-both}"
CONCURRENCY="${CONCURRENCY:-4}"

while IFS= read -r q || [ -n "$q" ]; do
  case "$q" in ''|\#*) continue ;; esac
  echo ">> ingesting: $q"
  node ingest.mjs --q "$q" --source "$SOURCE" --pages "$PAGES" \
    --pageSize "$PAGESIZE" --concurrency "$CONCURRENCY" \
    || echo "   (failed: $q)"
done < "$QFILE"
