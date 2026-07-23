#!/usr/bin/env bash
# Print a stopped ECS task's ENTIRE CloudWatch stream.
#
#   scripts/dump-task-logs.sh <log-group> <log-stream>
#
# Replaces `aws logs get-log-events --start-from-head --limit 200`, which showed
# the OLDEST 200 events. A failing task's error is at the END, so for anything
# chatty the window closed before reaching it — a staging DB copy spent its 200
# on `pg_dump | psql` COPY lines and the real error was never printed
# (checkin run 29890662528).
#
# get-log-events returns at most 1MB/10k events per call and a nextForwardToken
# that STOPS ADVANCING at the end of the stream — that repeat is the documented
# end-of-stream signal, and paging on it is the only way to guarantee the tail.
#
# Best-effort by contract: every failure path prints a marker and returns 0, so
# a logging problem can never fail a deploy that otherwise succeeded.
set -uo pipefail

GROUP="${1:?usage: dump-task-logs.sh <log-group> <log-stream>}"
STREAM="${2:?usage: dump-task-logs.sh <log-group> <log-stream>}"
MAX_PAGES="${MAX_LOG_PAGES:-50}"

token=""; prev=""; page=0
while [ "$page" -lt "$MAX_PAGES" ]; do
    page=$((page + 1))
    if [ -z "$token" ]; then
        out=$(aws logs get-log-events --log-group-name "$GROUP" --log-stream-name "$STREAM" \
                --start-from-head --limit 10000 --output json 2>&1)
    else
        out=$(aws logs get-log-events --log-group-name "$GROUP" --log-stream-name "$STREAM" \
                --start-from-head --limit 10000 --next-token "$token" --output json 2>&1)
    fi
    if [ $? -ne 0 ]; then
        # Page 1 failing means no logs at all; a later page means we already
        # printed most of it — say which, rather than implying nothing was read.
        [ "$page" = 1 ] && echo "(could not fetch logs)" || echo "(log fetch failed at page $page — output above is partial)"
        exit 0
    fi
    printf '%s' "$out" | jq -r '.events[].message' 2>/dev/null || echo "(could not parse log page $page)"
    token=$(printf '%s' "$out" | jq -r '.nextForwardToken // empty' 2>/dev/null)
    [ -z "$token" ] && break
    [ "$token" = "$prev" ] && break
    prev="$token"
done

[ "$page" -ge "$MAX_PAGES" ] && echo "(log dump truncated at $MAX_PAGES pages — raise MAX_LOG_PAGES if this is real output and not a loop)"
exit 0
