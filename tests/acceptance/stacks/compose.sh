#!/usr/bin/env bash
# Generic stack driver for the release acceptance runner (tests/acceptance/run.sh).
# It starts a disposable Docker Compose project, and it backs up and restores the
# project's NAMED volumes. It knows nothing about the key store: the same driver
# serves the Cosmian baseline and an OpenBao stack, as long as all state is in
# named volumes and the ports come from ACCEPT_API_PORT / ACCEPT_UI_PORT.
#
#   compose.sh up                 create and start the project, wait until healthy
#   compose.sh backup <dir>       stop the project, tar every named volume into <dir>
#   compose.sh restore <dir>      start a NEW project (<project>-restored) from <dir>
#   compose.sh down               remove every project this run made, with its volumes
#   compose.sh images             print "service image digest" of the running project
#   compose.sh logs [service]     last log lines
#
# Environment (run.sh sets the defaults):
#   ACCEPT_COMPOSE_FILES   colon-separated compose files
#   ACCEPT_PROJECT         compose project name (unique per run: never another person's stack)
#   ACCEPT_RUN_DIR         per-run folder (generated config, state of this driver)
#   ACCEPT_PREPARE_HOOK    optional command run before the first "up" (writes config into ACCEPT_RUN_DIR)
#   ACCEPT_POST_UP_HOOK    optional command run after each "up" and "restore" (for example: unseal)
#   ACCEPT_UP_HOOK         optional command that replaces "compose up" (gets ACCEPT_DC)
#   ACCEPT_ENV_HOOK        optional command that prints KEY=VALUE lines exported before compose
#   ACCEPT_HELPER_IMAGE    image with tar, used to copy volumes (default alpine:3.22)
#
# Each project also gets a host state folder, ACCEPT_STATE_DIR=$ACCEPT_RUN_DIR/state/<project>,
# for stacks that need bind mounts. backup/restore copy it with the named volumes.
set -euo pipefail

: "${ACCEPT_COMPOSE_FILES:?}" "${ACCEPT_PROJECT:?}" "${ACCEPT_RUN_DIR:?}"
HELPER="${ACCEPT_HELPER_IMAGE:-alpine:3.22}"
STATE="$ACCEPT_RUN_DIR/driver"
mkdir -p "$STATE"
[[ -f "$STATE/current" ]] || echo "$ACCEPT_PROJECT" > "$STATE/current"
CURRENT="$(cat "$STATE/current")"

files=()
IFS=: read -ra _f <<< "$ACCEPT_COMPOSE_FILES"
for f in "${_f[@]}"; do files+=(-f "$f"); done
state_of() { echo "$ACCEPT_RUN_DIR/state/$1"; }
if [[ -n "${ACCEPT_ENV_HOOK:-}" ]]; then
  _envs="$(ACCEPT_STATE_DIR="$(state_of "$CURRENT")" bash -c "$ACCEPT_ENV_HOOK")" || { echo "env hook failed: $ACCEPT_ENV_HOOK" >&2; exit 1; }
  while IFS='=' read -r k v; do [[ -n "$k" ]] && export "$k=$v"; done <<< "$_envs"
fi
dc() { local p="$1"; shift; ACCEPT_STATE_DIR="$(state_of "$p")" docker compose -p "$p" "${files[@]}" "$@"; }
# Start project $1: the up hook, or plain compose up.
start() {
  local p="$1"
  if [[ -n "${ACCEPT_UP_HOOK:-}" ]]; then
    ACCEPT_STATE_DIR="$(state_of "$p")" ACCEPT_DC="docker compose -p $p ${files[*]}" bash -c "$ACCEPT_UP_HOOK up"
  else
    dc "$p" up -d --quiet-pull --wait --wait-timeout "${ACCEPT_WAIT_TIMEOUT:-300}"
  fi
}

volumes_of() { docker volume ls -q --filter "label=com.docker.compose.project=$1"; }
# "<project>_<name>" -> "<name>"
short() { echo "${1#"$2"_}"; }

hook() {
  local cmd="${1:-}"
  [[ -z "$cmd" ]] && return 0
  ACCEPT_CURRENT_PROJECT="$2" ACCEPT_STATE_DIR="$(state_of "$2")" bash -c "$cmd"
}

claim_project() {
  local project="$1" filter="label=com.docker.compose.project=$1"
  if ! [[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Invalid Compose project name" >&2; return 1
  fi
  if [[ -n "$(docker ps -aq --filter "$filter")$(docker volume ls -q --filter "$filter")$(docker network ls -q --filter "$filter")" ]] ||
      grep -Fxq "$project" "$STATE/projects" 2>/dev/null; then
    echo "Project $project already exists. Use a fresh run tag and output directory." >&2; return 1
  fi
  echo "$project" >> "$STATE/projects"
}

cmd_up() {
  claim_project "$CURRENT"
  if [[ ! -f "$STATE/prepared" ]]; then
    mkdir -p "$(state_of "$CURRENT")"
    hook "${ACCEPT_PREPARE_HOOK:-}" "$CURRENT"
    touch "$STATE/prepared"
  fi
  mkdir -p "$(state_of "$CURRENT")"
  start "$CURRENT"
  hook "${ACCEPT_POST_UP_HOOK:-}" "$CURRENT"
}

cmd_backup() {
  local dir="$1"; mkdir -p "$dir"
  # A consistent copy: no process writes while the volumes are read.
  dc "$CURRENT" stop
  local v n=0
  for v in $(volumes_of "$CURRENT"); do
    docker run --rm -v "$v":/v:ro -v "$dir":/b "$HELPER" \
      tar -C /v -cpf "/b/$(short "$v" "$CURRENT").tar" .
    n=$((n + 1))
  done
  # The host state folder, as root, so owners and modes stay.
  local sd; sd="$(state_of "$CURRENT")"
  if [[ -d "$sd" && -n "$(ls -A "$sd" 2>/dev/null)" ]]; then
    docker run --rm -v "$sd":/s:ro -v "$dir":/b "$HELPER" tar -C /s -cpf /b/_state.tar .
    n=$((n + 1))
  fi
  (cd "$dir" && sha256sum ./*.tar > SHA256SUMS)
  echo "backup: $n volume(s) of $CURRENT in $dir"
  [[ $n -gt 0 ]] || { echo "backup: the project has no named volume" >&2; return 1; }
}

cmd_restore() {
  local dir="$1" target="${ACCEPT_PROJECT}-restored"
  (cd "$dir" && sha256sum -c --quiet SHA256SUMS)
  claim_project "$target"
  # The old project keeps its volumes (for comparison) but frees the ports.
  dc "$CURRENT" stop
  dc "$target" create --quiet-pull
  local t name
  local sd; sd="$(state_of "$target")"; mkdir -p "$sd"
  if [[ -f "$dir/_state.tar" ]]; then
    docker run --rm -v "$sd":/s -v "$dir":/b:ro "$HELPER" sh -c "tar -C /s -xpf /b/_state.tar --numeric-owner"
  fi
  for t in "$dir"/*.tar; do
    name="$(basename "$t" .tar)"
    [[ "$name" == _state ]] && continue
    docker volume inspect "${target}_${name}" >/dev/null
    docker run --rm -v "${target}_${name}":/v -v "$dir":/b:ro "$HELPER" \
      sh -c "find /v -mindepth 1 -delete && tar -C /v -xpf /b/$name.tar --numeric-owner"
  done
  echo "$target" > "$STATE/current"
  start "$target"
  hook "${ACCEPT_POST_UP_HOOK:-}" "$target"
  echo "restore: $target is up from $dir"
}

cmd_down() {
  local p
  sort -u "$STATE/projects" 2>/dev/null | while read -r p; do
    [[ -n "$p" ]] && dc "$p" down -v --remove-orphans >/dev/null 2>&1 || true
    # State files can belong to container users: remove them as root.
    [[ -n "$p" && -d "$(state_of "$p")" ]] && docker run --rm -v "$ACCEPT_RUN_DIR/state":/s "$HELPER" rm -rf "/s/$p" >/dev/null 2>&1 || true
  done
  rm -f "$STATE/projects" "$STATE/prepared"
  echo "$ACCEPT_PROJECT" > "$STATE/current"
}

cmd_images() {
  local id svc img digest
  for id in $(dc "$CURRENT" ps -q); do
    svc="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
    img="$(docker inspect -f '{{.Config.Image}}' "$id")"
    digest="$(docker image inspect -f '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$img")"
    echo "$svc $img $digest"
  done
}

case "${1:-}" in
  up) cmd_up ;;
  backup) cmd_backup "${2:?backup dir}" ;;
  restore) cmd_restore "${2:?backup dir}" ;;
  down) cmd_down ;;
  images) cmd_images ;;
  logs) dc "$CURRENT" logs --no-color --tail="${3:-200}" ${2:+"$2"} ;;
  project) echo "$CURRENT" ;;
  *) sed -n '2,24p' "$0"; exit 2 ;;
esac
