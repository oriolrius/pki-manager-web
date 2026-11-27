#!/usr/bin/env bash
# Connect to a synthetic host whose certificate comes from the restored backend.
# The client trusts the SSH host CA public key saved before v3 stopped.
set -euo pipefail
run=$1
network=$2
fixture="$run/sshd"
mkdir -p "$fixture"
install -m 600 "$run/host_key" "$fixture/host_key"
install -m 644 "$run/host-cert.pub" "$fixture/host-cert.pub"
ssh-keygen -q -t ed25519 -N '' -f "$run/ssh-client"
install -m 644 "$run/ssh-client.pub" "$fixture/client.pub"
printf '@cert-authority host1.rehearsal.test %s\n' "$(cat "$run/host-ca-v3.pub")" > "$run/known_hosts"

if ! docker image inspect pki-accept-sshd:local >/dev/null 2>&1; then
  docker build -q -t pki-accept-sshd:local "$(dirname "$0")/../../../tests/acceptance/sshd" >/dev/null
fi
id=$(docker run -d --label "pki-manager.rehearsal=$network" --network "$network" \
  -p 127.0.0.1::2222 -v "$fixture:/fixture:ro" pki-accept-sshd:local sh -ec '
    install -m 644 /fixture/client.pub /etc/ssh/rehearsal_authorized_keys
    exec /usr/sbin/sshd -D -e -f /dev/null -p 2222 -h /fixture/host_key \
      -o HostCertificate=/fixture/host-cert.pub -o AuthenticationMethods=publickey \
      -o PasswordAuthentication=no -o PermitRootLogin=no \
      -o AuthorizedKeysFile=/etc/ssh/rehearsal_authorized_keys')
trap 'docker rm -f "$id" >/dev/null 2>&1 || true' EXIT
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "2222/tcp") 0).HostPort}}' "$id")
# Docker can accept the first TCP connection before sshd listens inside the container.
# Wait for an SSH banner before the single authenticated connection that proves CA trust.
python3 - "$port" <<'PYREADY'
import socket
import sys
import time

deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    try:
        with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1) as sock:
            if sock.makefile("rb").readline(256).startswith(b"SSH-2.0-"):
                break
    except OSError:
        pass
    time.sleep(0.1)
else:
    sys.exit("The rehearsal SSH server did not send a banner within 10 seconds")
PYREADY
ssh -F /dev/null -p "$port" -i "$run/ssh-client" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none \
  -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ecdsa-sha2-nistp256-cert-v01@openssh.com \
  -o HostKeyAlias=host1.rehearsal.test -o GlobalKnownHostsFile=/dev/null \
  -o "UserKnownHostsFile=$run/known_hosts" -o ConnectTimeout=3 -o ConnectionAttempts=5 \
  acc@127.0.0.1 true
