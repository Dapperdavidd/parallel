#!/usr/bin/env bash
#
# Supervised keeper.
#
# The keeper itself now survives network faults (src/lib/stay-alive.ts), but a
# process on a laptop can still end for reasons it cannot catch: the host
# suspends and the runtime is killed, a terminal closes, Node runs out of
# memory. The index is the only thing standing between the app and "every
# market is paused", so it gets a supervisor: if the keeper exits for any
# reason other than a deliberate Ctrl-C, it is started again.
#
#   nohup scripts/keeper-supervise.sh > /dev/null 2>&1 &
#   tail -f /tmp/parallel-keeper.log
#
# `caffeinate -is` holds off idle sleep for as long as the keeper runs. It
# cannot stop a lid-close sleep — nothing can — so on a laptop, keep the lid
# open or plug in an external display. The real fix is a host that is not a
# laptop; see HANDOFF.md.
#
# Stop it with: pkill -f keeper-supervise.sh && pkill -f services/keeper.ts

set -u

cd "$(dirname "$0")/.." || exit 1

LOG="${KEEPER_LOG:-/tmp/parallel-keeper.log}"
EVERY="${KEEPER_EVERY:-120}"
RESTART_DELAY="${KEEPER_RESTART_DELAY:-10}"

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Keep one previous log rather than growing one file forever.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 20000000 ]; then
  mv "$LOG" "${LOG%.log}-prev.log"
fi

trap 'echo "── supervisor: stopped by signal at $(stamp)" >> "$LOG"; exit 0' INT TERM

while true; do
  echo "── supervisor: starting keeper at $(stamp) (every ${EVERY}s)" >> "$LOG"
  caffeinate -is npm run keeper -- --loop --every="$EVERY" >> "$LOG" 2>&1
  code=$?
  if [ "$code" -eq 130 ]; then
    echo "── supervisor: keeper stopped deliberately at $(stamp)" >> "$LOG"
    break
  fi
  echo "── supervisor: keeper exited ($code) at $(stamp) — restarting in ${RESTART_DELAY}s" >> "$LOG"
  sleep "$RESTART_DELAY"
done
