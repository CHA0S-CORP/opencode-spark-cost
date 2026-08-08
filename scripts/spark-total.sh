#!/usr/bin/env bash
# spark-total — lifetime energy cost + token totals across ALL opencode
# sessions, summed from the local opencode SQLite store. Each message is
# priced at whatever rate opencode-spark-cost set when it was generated.
#
# Usage: spark-total [--db PATH] [--provider ID]
#   --db PATH        opencode SQLite db (default: $OPENCODE_DB or
#                    ~/.local/share/opencode/opencode.db). --db=PATH also works.
#   --provider ID    limit to one provider id. --provider=ID also works.
# Requires: sqlite3 with json1 (built in by default since 3.38).

set -euo pipefail

DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
PROVIDER=""

# Print the leading comment block (usage), stopping at the first non-# line.
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --db=*)       DB="${1#*=}"; shift ;;
    --provider=*) PROVIDER="${1#*=}"; shift ;;
    --db)         [ $# -ge 2 ] || { echo "--db needs a path" >&2; exit 2; }
                  DB="$2"; shift 2 ;;
    --provider)   [ $# -ge 2 ] || { echo "--provider needs an id" >&2; exit 2; }
                  PROVIDER="$2"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
[ -f "$DB" ] || { echo "db not found: $DB" >&2; exit 1; }

FILTER="json_extract(data,'\$.role')='assistant'"
if [ -n "$PROVIDER" ]; then
  # Escape single quotes for SQL by doubling them.
  PROVIDER_ESC=${PROVIDER//\'/\'\'}
  FILTER="$FILTER AND json_extract(data,'\$.providerID')='$PROVIDER_ESC'"
fi

# -column -header works on all sqlite3 versions (box mode needs >=3.33).
sqlite3 -column -header "$DB" "
SELECT
  json_extract(data,'\$.providerID') AS provider,
  json_extract(data,'\$.modelID')    AS model,
  COUNT(*)                            AS msgs,
  printf('\$%.4f', COALESCE(SUM(json_extract(data,'\$.cost')),0)) AS cost,
  COALESCE(SUM(json_extract(data,'\$.tokens.input')),0)  AS in_tok,
  COALESCE(SUM(json_extract(data,'\$.tokens.output')),0) AS out_tok
FROM message
WHERE $FILTER
GROUP BY provider, model
ORDER BY COALESCE(SUM(json_extract(data,'\$.cost')),0) DESC;"

echo
sqlite3 "$DB" "
SELECT printf('TOTAL: \$%.4f across %d messages',
  COALESCE(SUM(json_extract(data,'\$.cost')),0), COUNT(*))
FROM message WHERE $FILTER;"
