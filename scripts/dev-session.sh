#!/usr/bin/env bash
#
# dev-session.sh — attach-or-create for the pki-manager dev stack.
#
# The dev stack (mprocs: backend + frontend + backlog) lives in a tmux session
# named after this repo. Running this script is ALWAYS safe and idempotent:
#
#   - session already running  -> reattach to it (never a second stack)
#   - session gone, ports free -> create it
#   - session gone, ports held -> report who holds them; only offer to kill
#                                 processes whose cwd is inside THIS repo
#
# This exists because the Orca terminal pane is not the owner of the process:
# an Orca update kills the pane but not the stack, and a plain `mprocs` relaunch
# would silently start a second one on shifted ports.
#
# Other projects run their own mprocs — this script never matches by process
# name, only by this repo's session name and by cwd of the port holder.
#
# Usage:
#   scripts/dev-session.sh [up|status|stop] [--force]
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SESSION="dev-$(basename "$REPO")"

# Ports this stack owns. Backend reads its own PORT from backend/.env.
BACKEND_PORT="$(sed -n 's/^PORT=\([0-9]\+\).*/\1/p' "$REPO/backend/.env" 2>/dev/null | head -1)"
PORTS=(52080 "${BACKEND_PORT:-52081}" 6430)

FORCE=0
CMD="up"
for arg in "$@"; do
  case "$arg" in
    up|status|stop) CMD="$arg" ;;
    --force|-f)     FORCE=1 ;;
    *) echo "usage: $(basename "$0") [up|status|stop] [--force]" >&2; exit 2 ;;
  esac
done

has_session() { tmux has-session -t "=$SESSION" 2>/dev/null; }

# PID listening on $1, or empty. The trailing `|| true` matters: without it the
# no-match grep exits 1 and, under `set -e -o pipefail`, kills the whole script
# on the most common path of all — every port free.
port_pid() {
  ss -ltnp 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

pid_cwd()  { readlink -f "/proc/$1/cwd" 2>/dev/null || true; }
pid_cmd()  { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | cut -c1-100; }
pid_pgid() { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }

# Classify whatever is sitting on our ports. Sets OURS / THEIRS.
scan_ports() {
  OURS=(); THEIRS=()
  local p pid cwd
  for p in "${PORTS[@]}"; do
    pid="$(port_pid "$p")"
    [ -n "$pid" ] || continue
    cwd="$(pid_cwd "$pid")"
    if [[ "$cwd" == "$REPO" || "$cwd" == "$REPO"/* ]]; then
      OURS+=("$p:$pid")
    else
      THEIRS+=("$p:$pid:${cwd:-?}")
    fi
  done
}

case "$CMD" in

status)
  if has_session; then
    echo "tmux session '$SESSION': RUNNING"
    tmux capture-pane -p -t "$SESSION" 2>/dev/null | sed 's/^/  | /'
  else
    echo "tmux session '$SESSION': not running"
  fi
  echo
  scan_ports
  if ((${#OURS[@]} + ${#THEIRS[@]} == 0)); then
    echo "  ports ${PORTS[*]}: all free"
  fi
  for e in ${OURS[@]+"${OURS[@]}"}; do
    pid="${e##*:}"
    echo "  port ${e%%:*}  ours    pid $pid  $(pid_cmd "$pid")"
  done
  for e in ${THEIRS[@]+"${THEIRS[@]}"}; do
    IFS=: read -r p pid cwd <<<"$e"
    echo "  port $p  FOREIGN pid $pid  cwd=$cwd"
  done
  ;;

stop)
  if has_session; then
    tmux kill-session -t "=$SESSION"
    echo "killed tmux session '$SESSION'"
    sleep 1
  fi
  scan_ports
  for e in ${OURS[@]+"${OURS[@]}"}; do
    pid="${e##*:}"; pgid="$(pid_pgid "$pid")"
    [ -n "$pgid" ] && kill -TERM -"$pgid" 2>/dev/null || true
    echo "  signalled leftover on port ${e%%:*} (pid $pid, pgid $pgid)"
  done
  for e in ${THEIRS[@]+"${THEIRS[@]}"}; do
    echo "  left port ${e%%:*} alone — belongs to another project"
  done
  echo "dev stack stopped."
  ;;

up)
  # Fast path: the stack is already up. Reattach, never duplicate.
  if has_session; then
    if [ -t 0 ] && [ -t 1 ]; then
      exec tmux attach-session -t "=$SESSION"
    fi
    echo "dev stack already running in tmux session '$SESSION' (not a TTY, not attaching)."
    echo "Attach with:  tmux attach -t $SESSION"
    echo
    tmux capture-pane -p -t "$SESSION" 2>/dev/null | sed 's/^/  | /'
    exit 0
  fi

  # No session: make sure nobody is squatting on our ports before we start.
  scan_ports
  if ((${#THEIRS[@]})); then
    echo "Refusing to start — these ports belong to another project:" >&2
    for e in "${THEIRS[@]}"; do
      IFS=: read -r p pid cwd <<<"$e"
      echo "  port $p  pid $pid  cwd=$cwd" >&2
    done
    echo "Free them or change this project's ports, then retry." >&2
    exit 1
  fi
  if ((${#OURS[@]})); then
    echo "Orphaned processes from THIS repo are holding our ports:"
    for e in "${OURS[@]}"; do
      pid="${e##*:}"
      echo "  port ${e%%:*}  pid $pid  $(pid_cmd "$pid")"
    done
    if ((FORCE)); then
      reply=y
    elif [ -t 0 ]; then
      read -rp "Kill them and start clean? [y/N] " reply
    else
      echo "Non-interactive: rerun with --force to kill them." >&2
      exit 1
    fi
    [[ "${reply:-n}" =~ ^[yY]$ ]] || { echo "Aborted."; exit 1; }
    for e in "${OURS[@]}"; do
      pid="${e##*:}"; pgid="$(pid_pgid "$pid")"
      [ -n "$pgid" ] && kill -TERM -"$pgid" 2>/dev/null || true
    done
    sleep 2
  fi

  # Create detached first so this works with or without a TTY, then attach if we
  # have one. `mprocs` itself always gets a real PTY from tmux, so it never hits
  # "Stdin is not a tty" — even when launched by an agent.
  tmux new-session -d -s "$SESSION" -c "$REPO" -x 200 -y 50 \
    "mprocs; printf '\n[dev stack stopped] press Enter to close this tmux session...'; read -r _"

  if [ -t 0 ] && [ -t 1 ]; then
    exec tmux attach-session -t "=$SESSION"
  fi
  echo "dev stack started detached in tmux session '$SESSION'."
  echo "Attach with:  tmux attach -t $SESSION"
  sleep 3
  tmux capture-pane -p -t "$SESSION" 2>/dev/null | sed 's/^/  | /'
  ;;
esac
