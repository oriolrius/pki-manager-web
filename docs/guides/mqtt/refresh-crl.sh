#!/usr/bin/env bash
# Fetch the CRL of the CA, check it, replace the broker file, tell Mosquitto to reload.
# The URL is the one inside the certificates (CRL_DISTRIBUTION_URL + /<CA id>.crl).
set -euo pipefail
CRL_URL="${CRL_URL:?set CRL_URL}"          # e.g. http://localhost:47300/crl/<CA id>.crl
CERTS="${CERTS:-/etc/mosquitto/certs}"      # folder with ca.pem and crl.pem
BROKER="${BROKER:-acme-mosquitto}"          # container name of the broker

tmp="$(mktemp "$CERTS/crl.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

curl -fsS --max-time 20 -o "$tmp" "$CRL_URL"                  # -f: a 404 is an error
openssl crl -in "$tmp" -CAfile "$CERTS/ca.pem" -noout         # fails if the CA did not sign it
chmod --reference="$CERTS/crl.pem" "$tmp"
mv "$tmp" "$CERTS/crl.pem"
trap - EXIT
docker kill -s HUP "$BROKER" >/dev/null                       # SIGHUP: Mosquitto reloads the CRL
echo "$(date -u +%FT%TZ) CRL updated, $(openssl crl -in "$CERTS/crl.pem" -noout -nextupdate)"
