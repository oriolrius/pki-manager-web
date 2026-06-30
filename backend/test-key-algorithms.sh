#!/bin/bash

# Smoke test: verify CA creation honors the requested key algorithm AND validity
# across the supported algorithms. Hits a running backend over tRPC.
#
# Every CA created here is tracked and force-deleted on exit (success or failure)
# so the test never leaves orphaned CAs behind in the instance it runs against.

set -u
BASE_URL="${BASE_URL:-http://localhost:3000}"
VALIDITY_YEARS=10
# A CA created with validityYears=N must be ~N*365 days, not the KMS 365-day default.
MIN_VALID_DAYS=$(( VALIDITY_YEARS * 365 - 30 ))

CREATED_CA_IDS=()
FAILURES=0

cleanup() {
  echo ""
  echo "=== Cleanup: removing ${#CREATED_CA_IDS[@]} test CA(s) ==="
  for id in "${CREATED_CA_IDS[@]}"; do
    [ -z "$id" ] && continue
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/trpc/ca.delete" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"${id}\",\"forceDelete\":true}")
    echo "  deleted ${id} (HTTP ${code})"
  done
}
trap cleanup EXIT

# create_and_check <label> <keyAlgorithm> <expected openssl key marker>
create_and_check() {
  local label="$1" alg="$2" marker="$3"
  echo "Test: Creating CA with ${label}..."

  local resp
  resp=$(curl -s -X POST "${BASE_URL}/trpc/ca.create" \
    -H "Content-Type: application/json" \
    -d "{\"subject\":{\"commonName\":\"Test ${label} CA\",\"organization\":\"Test Org\",\"country\":\"US\"},\"validityYears\":${VALIDITY_YEARS},\"keyAlgorithm\":\"${alg}\"}")

  if echo "$resp" | grep -q '"error"'; then
    echo "❌ FAILED to create: $resp"; FAILURES=$((FAILURES+1)); return
  fi

  local ca_id
  ca_id=$(echo "$resp" | jq -r '.result.data.id')
  CREATED_CA_IDS+=("$ca_id")
  echo "✓ Created CA: $ca_id"
  sleep 2

  local cert
  cert=$(curl -s "${BASE_URL}/trpc/ca.getById?input=%7B%22id%22%3A%22${ca_id}%22%7D" | jq -r '.result.data.certificatePem')

  # 1) key algorithm
  if echo "$cert" | openssl x509 -text -noout 2>/dev/null | grep -q "$marker"; then
    echo "✓ Key algorithm OK ($label)"
  else
    echo "❌ Wrong key algorithm for $label"; FAILURES=$((FAILURES+1))
  fi

  # 2) validity — must reflect validityYears, not the KMS 365-day default (regression guard)
  local nb na nb_s na_s days
  nb=$(echo "$cert" | openssl x509 -noout -startdate 2>/dev/null | cut -d= -f2)
  na=$(echo "$cert" | openssl x509 -noout -enddate   2>/dev/null | cut -d= -f2)
  nb_s=$(date -d "$nb" +%s); na_s=$(date -d "$na" +%s)
  days=$(( (na_s - nb_s) / 86400 ))
  if [ "$days" -ge "$MIN_VALID_DAYS" ]; then
    echo "✓ Validity OK: ${days} days (~$((days/365))y, requested ${VALIDITY_YEARS}y)"
  else
    echo "❌ Validity too short: ${days} days (expected ≥ ${MIN_VALID_DAYS}); validityYears was ignored"
    FAILURES=$((FAILURES+1))
  fi
  echo ""
}

echo "=== Testing Key Algorithm + Validity (target: ${BASE_URL}) ==="
echo ""
create_and_check "RSA-2048"   "RSA-2048"   "Public-Key: (2048 bit)"
create_and_check "ECDSA-P256" "ECDSA-P256" "id-ecPublicKey"
create_and_check "ECDSA-P384" "ECDSA-P384" "id-ecPublicKey"

echo "=== Test Complete: ${FAILURES} failure(s) ==="
exit $(( FAILURES > 0 ? 1 : 0 ))
