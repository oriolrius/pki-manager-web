#!/usr/bin/env bash
# dev-tls.sh DIR [SAN...] — DEV/TEST ONLY: a private CA and an OpenBao server certificate.
#
# Writes DIR/ca.pem, DIR/ca-key.pem, DIR/server.pem, DIR/server-key.pem (EC P-256) when
# they are missing, when the server certificate expires within 30 days, or when a
# requested SAN is not in it. The backend trusts DIR/ca.pem through OPENBAO_CACERT.
# The default SANs cover the dev stack (localhost), Compose service names and the
# Kubernetes e2e Service. Production uses certificates from your own CA:
# docs/operations/openbao.md
set -euo pipefail

dir="${1:?usage: dev-tls.sh DIR [SAN...]}"; shift || true
sans=(DNS:localhost DNS:openbao DNS:pki-manager-openbao IP:127.0.0.1 "$@")
mkdir -p "$dir"
umask 077

want_san() {
  local text; text="$(openssl x509 -in "$dir/server.pem" -noout -ext subjectAltName 2>/dev/null)" || return 0
  local s v
  for s in "${sans[@]}"; do
    v="${s#*:}"; [ "${s%%:*}" = IP ] && v="IP Address:$v" || v="DNS:$v"
    grep -qF "$v" <<<"$text" || return 0
  done
  return 1
}

if [ ! -s "$dir/ca.pem" ] || [ ! -s "$dir/ca-key.pem" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
    -subj "/CN=PKI Manager OpenBao dev CA/O=PKI Manager dev" \
    -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign \
    -keyout "$dir/ca-key.pem" -out "$dir/ca.pem" 2>/dev/null
  rm -f "$dir/server.pem"
  echo "dev-tls: new CA $dir/ca.pem"
fi

if [ ! -s "$dir/server.pem" ] || ! openssl x509 -in "$dir/server.pem" -noout -checkend $((30 * 86400)) >/dev/null || want_san; then
  san="$(IFS=,; echo "${sans[*]}")"
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=openbao" \
    -keyout "$dir/server-key.pem" -out "$dir/server.csr" 2>/dev/null
  openssl x509 -req -in "$dir/server.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca-key.pem" \
    -CAcreateserial -days 397 -out "$dir/server.pem" \
    -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=critical,CA:FALSE\n' "$san") 2>/dev/null
  rm -f "$dir/server.csr" "$dir/ca.srl"
  echo "dev-tls: new server certificate $dir/server.pem ($san)"
fi
# The CA certificate is public; the keys stay owner-only. TLS_KEY_MODE=0644 is for test
# stacks where the OpenBao container user differs from the file owner (CI runners).
chmod 644 "$dir/ca.pem" "$dir/server.pem"
chmod 600 "$dir/ca-key.pem"
chmod "${TLS_KEY_MODE:-600}" "$dir/server-key.pem"
