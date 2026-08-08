#!/usr/bin/env bash
# spark-total — lifetime energy cost + token totals across ALL opencode
# sessions, summed from the local opencode SQLite store. Each message is
# priced at whatever rate opencode-spark-cost set when it was generated.
#
# Usage: spark-total [--db PATH] [--provider ID]
# Requires: sqlite3 (with json1, standard since 3.9).

set -euo pipefail

DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
PROVIDER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | cut -c3-; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
[ -f "$DB" ] || { echo "db not found: $DB" >&2; exit 1; }

FILTER="json_extract(data,'\$.role')='assistant'"
[ -n "$PROVIDER" ] && FILTER="$FILTER AND json_extract(data,'\$.providerID')='$PROVIDER'"

sqlite3 -box "$DB" "
SELECT
  json_extract(data,'\$.providerID') AS provider,
  json_extract(data,'\$.modelID')    AS model,
  COUNT(*)                            AS msgs,
  printf('\$%.4f', SUM(COALESCE(json_extract(data,'\$.cost'),0))) AS cost,
  SUM(COALESCE(json_extract(data,'\$.tokens.input'),0))  AS in_tok,
  SUM(COALESCE(json_extract(data,'\$.tokens.output'),0)) AS out_tok
FROM message
WHERE $FILTER
GROUP BY provider, model
ORDER BY SUM(COALESCE(json_extract(data,'\$.cost'),0)) DESC;"

echo
sqlite3 "$DB" "
SELECT printf('TOTAL: \$%.4f across %d messages',
  SUM(COALESCE(json_extract(data,'\$.cost'),0)), COUNT(*))
FROM message WHERE $FILTER;"
