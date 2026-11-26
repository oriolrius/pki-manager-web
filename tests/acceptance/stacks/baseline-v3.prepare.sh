#!/usr/bin/env bash
# Prepare hook of the v3 baseline stack: the files that baseline-v3.compose.yml mounts.
# Copies are made world-readable here, so the repository files keep their own mode.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
: "${ACCEPT_RUN_DIR:?}" "${ACCEPT_API_PORT:?}"
install -m 0644 "$REPO/kms/kms.toml" "$ACCEPT_RUN_DIR/kms.toml"
printf '{"apiUrl":"http://localhost:%s/trpc"}\n' "$ACCEPT_API_PORT" > "$ACCEPT_RUN_DIR/config.json"
chmod 0644 "$ACCEPT_RUN_DIR/config.json"
