#!/usr/bin/env bash
# openbao-image.sh — the OpenBao image of the PKI Manager fork, pinned in openbao/image.env.
#
#   ensure   print the image reference to use; pull the published image, or build the
#            pinned commit when no published image is set and no local build exists
#   build    build the pinned commit now (also when a local build exists)
#   verify   check that IMAGE (default: the ensured one) runs the pinned commit
#
# Build source: the fork repository at OPENBAO_FORK_COMMIT (a git URL context, so no
# checkout is needed), or OPENBAO_SRC=/path/to/openbao, a local checkout whose HEAD must
# be that commit and clean. Only the image reference goes to stdout.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=../openbao/image.env
. "$REPO/openbao/image.env"
DOCKERFILE=downstream/pki-manager/image/Dockerfile
log() { echo "openbao-image: $*" >&2; }

build() {
  local ctx file="$DOCKERFILE" epoch="$OPENBAO_FORK_COMMIT_EPOCH"
  if [ -n "${OPENBAO_SRC:-}" ]; then
    ctx="$(cd "$OPENBAO_SRC" && pwd -P)"
    file="$ctx/$DOCKERFILE"
    [ "$(git -C "$ctx" rev-parse HEAD)" = "$OPENBAO_FORK_COMMIT" ] \
      || { log "error: $ctx is not at $OPENBAO_FORK_COMMIT"; exit 1; }
    [ -z "$(git -C "$ctx" status --porcelain)" ] || { log "error: $ctx has local changes"; exit 1; }
  else
    ctx="$OPENBAO_FORK_REPO#$OPENBAO_FORK_COMMIT"
  fi
  log "building $OPENBAO_LOCAL_IMAGE from $ctx"
  docker build --load -f "$file" \
    --build-arg OPENBAO_VERSION="$OPENBAO_VERSION" \
    --build-arg OPENBAO_COMMIT="$OPENBAO_FORK_COMMIT" \
    --build-arg SOURCE_DATE_EPOCH="$epoch" \
    -t "$OPENBAO_LOCAL_IMAGE" "$ctx" >&2
}

verify() {
  local image="$1" out
  out="$(docker run --rm --entrypoint bao "$image" version)"
  grep -q "($OPENBAO_FORK_COMMIT)" <<<"$out" || { log "error: $image is not $OPENBAO_FORK_COMMIT: $out"; exit 1; }
  log "$image: $out"
}

ensure() {
  if [ -n "$OPENBAO_PUBLISHED_IMAGE" ]; then
    docker image inspect "$OPENBAO_PUBLISHED_IMAGE" >/dev/null 2>&1 || docker pull -q "$OPENBAO_PUBLISHED_IMAGE" >&2
    echo "$OPENBAO_PUBLISHED_IMAGE"
    return
  fi
  docker image inspect "$OPENBAO_LOCAL_IMAGE" >/dev/null 2>&1 || { build; verify "$OPENBAO_LOCAL_IMAGE"; }
  echo "$OPENBAO_LOCAL_IMAGE"
}

case "${1:-ensure}" in
  ensure) ensure ;;
  build) build; verify "$OPENBAO_LOCAL_IMAGE"; echo "$OPENBAO_LOCAL_IMAGE" ;;
  verify) verify "${2:-$(ensure)}" ;;
  *) sed -n 's/^#   //p' "${BASH_SOURCE[0]}" >&2; exit 2 ;;
esac
