#!/usr/bin/env bash
# spark-total — energy cost + token totals across opencode sessions, summed
# from the local opencode SQLite store. Each message is priced at whatever
# rate opencode-spark-cost set when it was generated.
#
# Usage: spark-total [--db PATH] [--provider ID] [--by-session] [--periods]
#   --db PATH        opencode SQLite db (default: $OPENCODE_DB or
#                    ~/.local/share/opencode/opencode.db). --db=PATH also works.
#   --provider ID    limit to one provider id. --provider=ID also works.
#   --by-session     break down by session (title, model, cost, tokens).
#   --periods        today / this week / this month totals.
#   (default)        break down by provider/model + grand TOTAL.
# Requires: sqlite3 with json1 (built in by default since 3.38).

set -euo pipefail

DB="${OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
PROVIDER=""
MODE="rollup"

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
    --by-session) MODE="session"; shift ;;
    --periods)    MODE="periods"; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
[ -f "$DB" ] || { echo "db not found: $DB" >&2; exit 1; }

# --- message-level filter (assistant rows, optional provider) ---
MFILTER="json_extract(data,'\$.role')='assistant'"
# --- session-level filter (session.model JSON holds providerID) ---
SFILTER="1=1"
if [ -n "$PROVIDER" ]; then
  # Escape single quotes for SQL by doubling them.
  PROVIDER_ESC=${PROVIDER//\'/\'\'}
  MFILTER="$MFILTER AND json_extract(data,'\$.providerID')='$PROVIDER_ESC'"
  SFILTER="json_extract(model,'\$.providerID')='$PROVIDER_ESC'"
fi

# Local-time period buckets from message.time_created (epoch ms).
TS="time_created/1000,'unixepoch','localtime'"

case "$MODE" in
  periods)
    sqlite3 -column -header "$DB" "
    SELECT
      printf('\$%.4f', COALESCE(SUM(CASE WHEN date($TS)=date('now','localtime')
             THEN json_extract(data,'\$.cost') END),0))                       AS today,
      printf('\$%.4f', COALESCE(SUM(CASE WHEN strftime('%Y-%W',$TS)=strftime('%Y-%W','now','localtime')
             THEN json_extract(data,'\$.cost') END),0))                       AS this_week,
      printf('\$%.4f', COALESCE(SUM(CASE WHEN strftime('%Y-%m',$TS)=strftime('%Y-%m','now','localtime')
             THEN json_extract(data,'\$.cost') END),0))                       AS this_month,
      printf('\$%.4f', COALESCE(SUM(json_extract(data,'\$.cost')),0))         AS all_time
    FROM message WHERE $MFILTER;"
    ;;

  session)
    # session table carries pre-aggregated cost/tokens/title/model.
    sqlite3 -column -header "$DB" "
    SELECT
      substr(COALESCE(NULLIF(title,''),'(untitled)'),1,44) AS session,
      json_extract(model,'\$.id')                          AS model,
      printf('\$%.4f', COALESCE(cost,0))                   AS cost,
      COALESCE(tokens_input,0)                             AS in_tok,
      COALESCE(tokens_output,0)                            AS out_tok,
      date(time_created/1000,'unixepoch','localtime')      AS started
    FROM session
    WHERE $SFILTER
    ORDER BY COALESCE(cost,0) DESC, time_created DESC
    LIMIT 40;"
    echo
    sqlite3 "$DB" "
    SELECT printf('TOTAL: \$%.4f across %d sessions',
      COALESCE(SUM(cost),0), COUNT(*)) FROM session WHERE $SFILTER;"
    ;;

  *)
    sqlite3 -column -header "$DB" "
    SELECT
      json_extract(data,'\$.providerID') AS provider,
      json_extract(data,'\$.modelID')    AS model,
      COUNT(*)                            AS msgs,
      printf('\$%.4f', COALESCE(SUM(json_extract(data,'\$.cost')),0)) AS cost,
      COALESCE(SUM(json_extract(data,'\$.tokens.input')),0)  AS in_tok,
      COALESCE(SUM(json_extract(data,'\$.tokens.output')),0) AS out_tok
    FROM message
    WHERE $MFILTER
    GROUP BY provider, model
    ORDER BY COALESCE(SUM(json_extract(data,'\$.cost')),0) DESC;"
    echo
    sqlite3 "$DB" "
    SELECT printf('TOTAL: \$%.4f across %d messages',
      COALESCE(SUM(json_extract(data,'\$.cost')),0), COUNT(*))
    FROM message WHERE $MFILTER;"
    ;;
esac
