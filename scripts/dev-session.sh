#!/usr/bin/env bash
#
# dev-session.sh — the pki-manager dev stack.
#
# Use it through `just` (see the justfile); this script is the implementation.
#
# The stack is mprocs (backend + frontend, see mprocs.yaml) inside a tmux session named
# after the repository, plus the Backlog.md web UI in a second tmux session. The terminal
# that starts it does not own it: the sessions survive a closed terminal, and an agent can
# start them without a TTY.
#
#   restart  stop this repository's stack, then start it again        (just dev)
#   backlog  restart only the Backlog.md web UI, on 0.0.0.0           (just backlog)
#   attach   open the running stack; does not restart it              (just attach)
#   status   session, ports and OIDC mode                             (just status)
#   urls     where to open each service                               (just urls)
#   logs     last lines of the process logs: logs [name] [lines]      (just logs)
#   stop     stop the processes; OpenBao and Keycloak keep running    (just stop)
#   down     stop + the docker dependencies (OpenBao, Keycloak)       (just down)
#   openbao  restart nothing; (re)start OpenBao, unseal it, print its env (just openbao)
#
# Two rules that keep other projects safe:
#   - a process is never matched by name (every project runs its own mprocs, node, vite);
#   - a process is ours only when its working directory is inside this repository
#     or one of its git worktrees. A port held from anywhere else stops the start.
#
# Worktrees of this repository share ONE stack: same session name, same ports, and the
# docker dependencies keep their state in the main checkout (openbao/dev-state), so the OpenBao
# data, unseal key and backend token stay in one place for every worktree.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMMON="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
MAIN="$REPO"
[ -n "$COMMON" ] && MAIN="$(dirname "$COMMON")"
# Fixed names: the folder is pki-manager-web, but the sessions keep the project name.
SESSION="dev-pki-manager"
BL_SESSION="backlog-pki-manager"

# Value of KEY in backend/.env, or empty (also when the file is missing or the line is commented out).
env_value() { sed -n "s/^$1=\(.*\)/\1/p" "$REPO/backend/.env" 2>/dev/null | head -1 || true; }

# Ports this stack owns. The backend reads its own PORT from backend/.env.
BACKEND_PORT="$(env_value PORT | grep -oE '^[0-9]+' || true)"
BACKEND_PORT="${BACKEND_PORT:-52081}"
FRONTEND_PORT=52080
# `backlog browser` binds 127.0.0.1 only. It listens on BACKLOG_INNER, and a socat relay
# publishes it on 0.0.0.0:BACKLOG_PORT (all interfaces: Windows, LAN, iPad).
BACKLOG_PORT=52082
BACKLOG_INNER=52083
BL_PORTS=("$BACKLOG_PORT" "$BACKLOG_INNER")
PORTS=("$FRONTEND_PORT" "$BACKEND_PORT" "${BL_PORTS[@]}")

# OIDC issuer from backend/.env (empty when the line is commented out = login off).
OIDC_ISSUER="$(env_value OIDC_ISSUER)"

# OpenBao (PKI Manager fork) for the dev stack: openbao/docker-compose.yml, state in the main
# checkout. DEV ONLY: one unseal key and the root token sit in openbao/dev-state/secrets.
OPENBAO_PORT=42996
OPENBAO_SRC_DIR="$REPO/openbao"
OPENBAO_STATE_DIR="${OPENBAO_DEV_STATE_DIR:-$MAIN/openbao/dev-state}"
# Early OpenBao development checkouts kept the dev shares and Raft state here.
# Reuse those keys unless the operator explicitly selects a new dev instance.
if [[ -z "${OPENBAO_DEV_STATE_DIR:-}" && ! -e "$OPENBAO_STATE_DIR" &&
      -s "$MAIN/openbao/state/secrets/dev-unseal-key" && -s "$MAIN/openbao/state/secrets/dev-root-token" ]]; then
  OPENBAO_STATE_DIR="$MAIN/openbao/state"
fi

usage() { grep -E '^#   [a-z]+ ' "${BASH_SOURCE[0]}" | sed 's/^#   //' >&2; exit 2; }

CMD="${1:-}"
[ -n "$CMD" ] || usage
shift
FORCE=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

has_session() { tmux has-session -t "=$SESSION" 2>/dev/null; }

# The checkout that started the running session (a worktree can start it).
session_repo() {
  local d
  d="$(tmux show-environment -t "=$SESSION" DEV_REPO 2>/dev/null | sed -n 's/^DEV_REPO=//p')"
  echo "${d:-$REPO}"
}

# Every checkout of this repository: the main one and its worktrees.
checkouts() {
  git -C "$REPO" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p'
  echo "$REPO"
}

is_ours() {
  local cwd="$1" w
  [ -n "$cwd" ] || return 1
  while IFS= read -r w; do
    [ -n "$w" ] || continue
    if [[ "$cwd" == "$w" || "$cwd" == "$w"/* ]]; then return 0; fi
  done < <(checkouts)
  return 1
}

# PID listening on $1, or empty. The trailing `|| true` matters: without it the
# no-match grep exits 1 and, under `set -e -o pipefail`, ends the script on the
# most common path of all — every port free.
port_pid() {
  ss -ltnp 2>/dev/null | grep -E "[:.]$1[[:space:]]" | grep -oP 'pid=\K[0-9]+' | head -1 || true
}
pid_cwd()  { readlink -f "/proc/$1/cwd" 2>/dev/null || true; }
pid_cmd()  { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | cut -c1-100; }
pid_pgid() { ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '; }

# Classify whatever listens on our ports. Sets OURS (port:pid) and THEIRS (port:pid:cwd).
# Ports to scan: the arguments, or all of PORTS.
scan_ports() {
  OURS=(); THEIRS=()
  local p pid cwd list=("$@")
  ((${#list[@]})) || list=("${PORTS[@]}")
  for p in "${list[@]}"; do
    pid="$(port_pid "$p")"
    [ -n "$pid" ] || continue
    cwd="$(pid_cwd "$pid")"
    if is_ours "$cwd"; then OURS+=("$p:$pid"); else THEIRS+=("$p:$pid:${cwd:-?}"); fi
  done
}

# Stop the sessions and every leftover of this repository on our ports. Idempotent.
stop_stack() {
  local s
  for s in "$SESSION" "$BL_SESSION"; do
    if tmux has-session -t "=$s" 2>/dev/null; then
      tmux kill-session -t "=$s"
      echo "stopped tmux session '$s'"
    fi
  done
  free_ports "${PORTS[@]}"
}

# Stop only the Backlog.md web UI of this repository. Idempotent.
stop_backlog() {
  if tmux has-session -t "=$BL_SESSION" 2>/dev/null; then
    tmux kill-session -t "=$BL_SESSION"
    echo "stopped tmux session '$BL_SESSION'"
  fi
  free_ports "${BL_PORTS[@]}"
}

# Kill what this repository still has on the given ports (TERM, then KILL). A port
# held by another project is left alone.
free_ports() {
  local own try e pid pgid sig
  own="$(pid_pgid $$)"
  for try in 1 2 3 4 5 6 7 8 9 10; do
    scan_ports "$@"
    ((${#OURS[@]})) || return 0
    sig=TERM
    ((try > 5)) && sig=KILL
    for e in "${OURS[@]}"; do
      pid="${e##*:}"; pgid="$(pid_pgid "$pid")"
      ((try == 1)) && echo "  stopping leftover on port ${e%%:*} (pid $pid: $(pid_cmd "$pid"))"
      if [ -n "$pgid" ] && [ "$pgid" != "$own" ]; then
        kill "-$sig" -- "-$pgid" 2>/dev/null || true
      else
        kill "-$sig" "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
  done
  scan_ports "$@"
  if ((${#OURS[@]})); then
    echo "error: could not free port(s): ${OURS[*]%%:*}" >&2
    exit 1
  fi
}

# Stop when another project holds one of the given ports. Run after our own leftovers are gone.
refuse_foreign() {
  scan_ports "$@"
  ((${#THEIRS[@]})) || return 0
  local e p pid cwd
  echo "Not starting — these ports belong to another project:" >&2
  for e in "${THEIRS[@]}"; do
    IFS=: read -r p pid cwd <<<"$e"
    echo "  port $p  pid $pid  cwd=$cwd  $(pid_cmd "$pid")" >&2
  done
  echo "Stop that process or change this project's ports, then try again." >&2
  exit 1
}

# Start the Backlog.md web UI in its own tmux session (see `backlog-serve`).
start_backlog() {
  need backlog; need socat
  mkdir -p "$REPO/.dev-logs"
  tmux new-session -d -s "$BL_SESSION" -c "$REPO" -x 160 -y 40 \
    "bash scripts/dev-session.sh backlog-serve 2>&1 | tee .dev-logs/backlog.log"
  local i
  for i in $(seq 1 30); do
    [ -n "$(port_pid "$BACKLOG_INNER")" ] && [ -n "$(port_pid "$BACKLOG_PORT")" ] && break
    sleep 0.5
  done
  if [ -n "$(port_pid "$BACKLOG_INNER")" ]; then
    echo "Backlog web UI on 0.0.0.0:$BACKLOG_PORT (tmux session '$BL_SESSION', log .dev-logs/backlog.log)"
  else
    echo "warning: Backlog did not start in 15 s — see 'just logs backlog'" >&2
  fi
}

# docker compose for the dev OpenBao (compose files of OPENBAO_SRC_DIR, state of MAIN).
openbao_compose() {
  OPENBAO_IMAGE="$OPENBAO_IMAGE" OPENBAO_STATE_DIR="$OPENBAO_STATE_DIR" OPENBAO_PORT="$OPENBAO_PORT" \
  OPENBAO_UID="$(id -u)" OPENBAO_GID="$(id -g)" \
    docker compose -p pki-manager-openbao --project-directory "$OPENBAO_SRC_DIR" \
      -f "$OPENBAO_SRC_DIR/docker-compose.yml" "$@"
}

# Start the dev OpenBao: image of the pinned fork commit (built once), dev TLS, Raft
# storage, then init (first run), unseal and configure it and write the backend token.
# Idempotent. Sets OPENBAO_ENV: the backend settings that mprocs gets.
ensure_openbao() {
  need openssl
  OPENBAO_IMAGE="$(bash "$REPO/scripts/openbao-image.sh" ensure)"
  mkdir -p "$OPENBAO_STATE_DIR"/{data,logs,tls,secrets}
  bash "$OPENBAO_SRC_DIR/scripts/dev-tls.sh" "$OPENBAO_STATE_DIR/tls"
  openbao_compose up -d --wait --wait-timeout 120 --quiet-pull openbao >&2
  openbao_compose run --rm -T bootstrap dev >&2
  [ -s "$OPENBAO_STATE_DIR/secrets/backend-token" ] \
    || { echo "error: OpenBao bootstrap failed — see 'docker logs pki-manager-openbao'" >&2; exit 1; }
  OPENBAO_ENV=(
    "OPENBAO_ADDR=https://localhost:$OPENBAO_PORT"
    "OPENBAO_CACERT=$OPENBAO_STATE_DIR/tls/ca.pem"
    "OPENBAO_TOKEN_FILE=$OPENBAO_STATE_DIR/secrets/backend-token"
  )
}

# Start the docker dependencies before mprocs: OpenBao always, the dev Keycloak when OIDC
# login is on (the default dev posture).
# Idempotent: `docker compose up -d` does nothing for a running container.
ensure_infra() {
  OPENBAO_ENV=()
  if ! command -v docker >/dev/null 2>&1; then
    echo "warning: docker not found — start openbao/ (and keycloak/) yourself" >&2
    return 0
  fi
  ensure_openbao
  local dirs=() d i
  [[ "$OIDC_ISSUER" == http://localhost:42997/* ]] && dirs+=(keycloak)
  for d in ${dirs[@]+"${dirs[@]}"}; do
    docker compose --project-directory "$MAIN/$d" -f "$MAIN/$d/docker-compose.yml" up -d --quiet-pull 2>&1 \
      | grep -vE '^\s*(Container .* (Running|Started)|$)' || true
  done
  if [[ " ${dirs[*]} " == *" keycloak "* ]]; then
    printf 'waiting for Keycloak (%s) ' "$OIDC_ISSUER"
    for i in $(seq 1 60); do
      if curl -sf -o /dev/null "$OIDC_ISSUER/.well-known/openid-configuration"; then
        echo "ready"
        return 0
      fi
      printf '.'
      sleep 2
    done
    echo " not ready after 120 s — the backend will fail OIDC init; see 'docker logs pki-manager-keycloak'" >&2
  fi
}

print_urls() {
  echo "Dev stack — open with http://localhost (OIDC login needs a secure context):"
  echo "  Web UI    http://localhost:$FRONTEND_PORT"
  echo "  API       http://localhost:$BACKEND_PORT/api/docs"
  echo "  Backlog   http://localhost:$BACKLOG_PORT  (all interfaces: http://<this host>:$BACKLOG_PORT)"
  echo "  OpenBao   https://localhost:$OPENBAO_PORT  (CA: $OPENBAO_STATE_DIR/tls/ca.pem; dev root token: $OPENBAO_STATE_DIR/secrets/dev-root-token)"
  if [ -n "$OIDC_ISSUER" ]; then
    echo "  OIDC      $OIDC_ISSUER"
  else
    echo "  OIDC      off (backend/.env has no OIDC_ISSUER): no login"
  fi
}

# The mprocs screen, cut to a readable size (the session is 200 columns wide).
show_screen() { tmux capture-pane -p -t "=$SESSION:" 2>/dev/null | cut -c1-118 | sed -e 's/[[:space:]]*$//' -e 's/^/  | /' | head -"${1:-16}"; }

attach_or_show() {
  if [ -t 0 ] && [ -t 1 ]; then
    exec tmux attach-session -t "=$SESSION"
  fi
  echo "tmux session '$SESSION' (no TTY here, not attaching). Open it with: just attach"
  show_screen
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is not installed" >&2; exit 1; }; }

case "$CMD" in

restart)
  need tmux; need mprocs
  for f in backend/.env frontend/.env; do
    [ -f "$REPO/$f" ] || { echo "error: $f is missing — run 'just setup'" >&2; exit 1; }
  done
  [ -d "$REPO/node_modules" ] || { echo "error: dependencies are not installed — run 'just setup'" >&2; exit 1; }

  stop_stack

  # Our own processes are gone. Whatever still holds a port belongs to someone else.
  refuse_foreign "${PORTS[@]}"

  ensure_infra

  # Created detached, so it works with or without a TTY. mprocs gets a real PTY from
  # tmux, so it never fails with "Stdin is not a tty". Each process also writes
  # .dev-logs/<name>.log (just logs). The OpenBao settings go into the session
  # environment; the process environment wins over backend/.env (node --env-file).
  mkdir -p "$REPO/.dev-logs"
  envs=()
  for e in ${OPENBAO_ENV[@]+"${OPENBAO_ENV[@]}"}; do envs+=(-e "$e"); done
  tmux new-session -d -s "$SESSION" -c "$REPO" -x 200 -y 50 ${envs[@]+"${envs[@]}"} \
    "mprocs --log-dir .dev-logs --log-mode truncate; printf '\n[dev stack stopped] press Enter to close this tmux session...'; read -r _"
  tmux set-environment -t "=$SESSION" DEV_REPO "$REPO"
  start_backlog

  print_urls
  sleep 3
  attach_or_show
  ;;

backlog)
  need tmux
  stop_backlog
  refuse_foreign "${BL_PORTS[@]}"
  start_backlog
  echo "  http://localhost:$BACKLOG_PORT"
  ;;

backlog-serve)
  # Runs inside the tmux session. Backlog on 127.0.0.1:BACKLOG_INNER, restarted when it
  # exits; capped at 1G RAM and no swap, because `backlog browser` leaks heap on a busy
  # repository (it reached 16G once): the kernel kills only it. socat publishes it on
  # 0.0.0.0:BACKLOG_PORT. Killing the tmux session stops both.
  cd "$REPO"
  (
    while :; do
      systemd-run --user --scope -q -p MemoryMax=1G -p MemorySwapMax=0 \
        backlog browser --no-open --port "$BACKLOG_INNER" || true
      echo "[backlog exited, restart in 2 s]"
      sleep 2
    done
  ) &
  trap 'trap - EXIT INT TERM HUP; kill 0' EXIT INT TERM HUP
  socat "TCP4-LISTEN:$BACKLOG_PORT,bind=0.0.0.0,reuseaddr,fork" "TCP4:127.0.0.1:$BACKLOG_INNER"
  ;;

attach)
  need tmux
  has_session || { echo "The dev stack is not running. Start it with: just dev" >&2; exit 1; }
  attach_or_show
  ;;

status)
  if has_session; then
    echo "tmux session '$SESSION': RUNNING (started from $(session_repo))"
    show_screen
  else
    echo "tmux session '$SESSION': not running"
  fi
  if tmux has-session -t "=$BL_SESSION" 2>/dev/null; then
    echo "tmux session '$BL_SESSION': RUNNING (Backlog web UI on 0.0.0.0:$BACKLOG_PORT)"
  else
    echo "tmux session '$BL_SESSION': not running (start it with: just backlog)"
  fi
  echo "OIDC login: ${OIDC_ISSUER:-off (backend/.env has no OIDC_ISSUER)}"
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

urls)
  print_urls
  ;;

logs)
  dir="$(session_repo)/.dev-logs"
  [ -d "$dir" ] || { echo "No logs yet — start the stack with: just dev" >&2; exit 1; }
  name="${ARGS[0]:-}"; lines="${ARGS[1]:-80}"
  if [ -n "$name" ]; then
    [ -f "$dir/$name.log" ] || { echo "No log for '$name'. Logs: $(cd "$dir" && ls *.log 2>/dev/null | sed 's/\.log$//' | tr '\n' ' ')" >&2; exit 1; }
    files=("$dir/$name.log")
  else
    files=("$dir"/*.log)
  fi
  # Follow only on a terminal: an agent gets the last lines and the command ends.
  if [ -t 1 ]; then exec tail -n "$lines" -f "${files[@]}"; fi
  tail -n "$lines" "${files[@]}"
  ;;

stop)
  stop_stack
  scan_ports
  for e in ${THEIRS[@]+"${THEIRS[@]}"}; do
    echo "  left port ${e%%:*} alone — it belongs to another project"
  done
  echo "dev stack stopped (OpenBao and Keycloak still running — 'just down' stops them too)."
  ;;

down)
  stop_stack
  # `stop`, not `down`: containers and data are kept, and a stopped container with
  # `restart: unless-stopped` stays stopped until the next `just dev`.
  if command -v docker >/dev/null 2>&1; then
    docker compose --project-directory "$MAIN/keycloak" -f "$MAIN/keycloak/docker-compose.yml" stop
    docker stop pki-manager-openbao 2>/dev/null | sed 's/^/  stopped /' || true
  fi
  echo "dev stack down: processes, OpenBao and Keycloak stopped (OpenBao seals; the next 'just dev' unseals it)."
  ;;

openbao)
  # Start (or unseal) only the dev OpenBao and print the backend settings, e.g. for a
  # backend started by hand: eval "$(just openbao | grep ^OPENBAO_)".
  need docker
  ensure_openbao
  printf '%s\n' "${OPENBAO_ENV[@]}"
  ;;

*)
  usage
  ;;
esac
