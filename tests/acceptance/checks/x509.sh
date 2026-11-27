# X.509 checks: CA and leaf profiles, REST/tRPC parity, exports, renew, revoke, CRL, CSR signing.
# Every result is verified with OpenSSL (or keytool), not with the API's own answer.
# shellcheck shell=bash

# Expected EKU text (OpenSSL names) per certificate type.
eku_for() {
  case "$1" in
    server) echo "TLS Web Server Authentication" ;;
    client) echo "TLS Web Client Authentication" ;;
    dual) echo "TLS Web Server Authentication, TLS Web Client Authentication" ;;
    email) echo "E-mail Protection" ;;
    code_signing) echo "Code Signing" ;;
  esac
}
key_bits() { openssl x509 -in "$1" -noout -text | grep -oE 'Public-Key: \([0-9]+ bit' | grep -oE '[0-9]+'; }
pubkey_sha() { openssl x509 -in "$1" -noout -pubkey | openssl pkey -pubin -outform der | sha256sum | cut -c1-64; }
serial_octets() { local s; s="$(openssl x509 -in "$1" -noout -serial | cut -d= -f2)"; echo $(( (${#s} + 1) / 2 )); }
ski_of() { openssl x509 -in "$1" -noout -ext subjectKeyIdentifier | tail -1 | tr -d ' '; }
aki_of() { openssl x509 -in "$1" -noout -ext authorityKeyIdentifier | grep -v Authority | head -1 | sed 's/keyid://' | tr -d ' '; }

check_x509_ca_profiles() {
  need openssl jq || return 0
  local alg id pem bits
  for alg in RSA-2048 RSA-4096; do
    if ! id="$(create_ca "Accept Root $alg $RUN_TAG" "$alg")"; then fail "create CA $alg (HTTP $STATUS: $(body | head -c 300))"; continue; fi
    pem="$WORK/ca-$id.pem"
    echo "$id" >> "$WORK/ca-ids"
    assert "CA $alg is self-signed and verifies" verify_chain "$pem" "$pem"
    bits="$(key_bits "$pem")"
    assert "CA $alg key is ${alg#RSA-} bit (got $bits)" test "$bits" = "${alg#RSA-}"
    assert "CA $alg basicConstraints critical CA:TRUE" bash -c "openssl x509 -in '$pem' -noout -ext basicConstraints | grep -A1 critical | grep -q 'CA:TRUE'"
    assert "CA $alg keyUsage has keyCertSign and cRLSign" bash -c "openssl x509 -in '$pem' -noout -ext keyUsage | grep -q 'Certificate Sign, CRL Sign'"
    local subj; subj="$(openssl x509 -in "$pem" -noout -subject -nameopt RFC2253,sep_multiline | sed 's/^ *//' | sort | tr '\n' '|')"
    assert "CA $alg subject keeps CN/O/OU/C/ST/L" test "$subj" = "C=ES|CN=Accept Root $alg $RUN_TAG|L=Barcelona|O=Acceptance Test|OU=Release|ST=Barcelona|subject=|"
    assert "CA $alg serial is at most 20 octets" test "$(serial_octets "$pem")" -le 20
  done
}

# Each type with each leaf algorithm (5 x 4 = 20 certificates) from the RSA-2048 CA,
# and one leaf from the RSA-4096 CA.
check_x509_leaf_profiles() {
  need openssl jq || return 0
  local ca ca4 cap type alg id pem extra n=0
  ca="$(sed -n 1p "$WORK/ca-ids" 2>/dev/null)"; ca4="$(sed -n 2p "$WORK/ca-ids" 2>/dev/null)"
  [[ -n "$ca" ]] || { fail "no CA from x509_ca_profiles"; return 0; }
  cap="$WORK/ca-$ca.pem"
  for type in server client dual email code_signing; do
    for alg in RSA-2048 RSA-4096 ECDSA-P256 ECDSA-P384; do
      n=$((n + 1))
      if [[ "$type" == code_signing && "$alg" == RSA-2048 ]]; then
        # Product rule: code signing needs RSA-3072, RSA-4096 or ECDSA-P256 and above.
        issue "$ca" "$type" "$alg" "leaf$n.accept.test" >/dev/null 2>&1
        assert "code_signing RSA-2048 is refused by policy (HTTP $STATUS)" bash -c "grep -q 'Code signing certificates require' '$BODY_FILE'"
        continue
      fi
      case "$type" in
        server|dual) extra="$(jq -cn --arg d "leaf$n.accept.test" '{sanDns:[$d, ("www."+$d)], sanIp:["192.0.2.\('"$n"')", "2001:db8::\('"$n"')"]}')" ;;
        email) extra='{"sanEmail":["release-'"$n"'@accept.test"]}' ;;
        client) extra='{"sanEmail":["client-'"$n"'@accept.test"]}' ;;
        *) extra='{}' ;;
      esac
      if ! id="$(issue "$ca" "$type" "$alg" "leaf$n.accept.test" "$extra")"; then
        fail "issue $type $alg (HTTP $STATUS: $(body | head -c 300))"; continue
      fi
      pem="$WORK/cert-$id.pem"
      printf '%s %s %s\n' "$id" "$type" "$alg" >> "$WORK/leaf-ids"
      local ok=1 why=""
      verify_chain "$cap" "$pem" >/dev/null 2>&1 || { ok=0; why+=" chain"; }
      ext_text "$pem" | grep -A1 'Extended Key Usage' | grep -qF "$(eku_for "$type")" || { ok=0; why+=" eku"; }
      ext_text "$pem" | grep -A1 'Basic Constraints' | grep -q 'CA:FALSE' || { ok=0; why+=" bc"; }
      ext_text "$pem" | grep -q 'X509v3 CRL Distribution Points' || { ok=0; why+=" cdp"; }
      [[ "$(aki_of "$pem")" == "$(ski_of "$cap")" ]] || { ok=0; why+=" aki"; }
      [[ "$(serial_octets "$pem")" -le 20 ]] || { ok=0; why+=" serial"; }
      case "$alg" in
        RSA-*) [[ "$(key_bits "$pem")" == "${alg#RSA-}" ]] || { ok=0; why+=" keysize"; } ;;
        ECDSA-P256) ext_text "$pem" | grep -q 'prime256v1\|P-256' || { ok=0; why+=" curve"; } ;;
        ECDSA-P384) ext_text "$pem" | grep -q 'secp384r1\|P-384' || { ok=0; why+=" curve"; } ;;
      esac
      case "$type" in
        server|dual)
          ext_text "$pem" | grep -q "DNS:leaf$n.accept.test, DNS:www.leaf$n.accept.test" || { ok=0; why+=" san-dns"; }
          ext_text "$pem" | grep -q "IP Address:192.0.2.$n" || { ok=0; why+=" san-ip"; }
          ext_text "$pem" | grep -qi "IP Address:2001:DB8:0:0:0:0:0:$n\b\|IP Address:2001:db8::$n\b" || { ok=0; why+=" san-ipv6"; } ;;
        email) ext_text "$pem" | grep -q "email:release-$n@accept.test" || { ok=0; why+=" san-email"; } ;;
      esac
      if [[ $ok == 1 ]]; then pass "leaf $type $alg: chain, EKU, CA:FALSE, CDP, AKI, serial, key, SAN"; else fail "leaf $type $alg:$why"; fi
    done
  done
  if [[ -n "$ca4" ]]; then
    if id="$(issue "$ca4" server ECDSA-P256 "rsa4096-ca.accept.test" '{"sanDns":["rsa4096-ca.accept.test"]}')"; then
      assert "leaf from the RSA-4096 CA verifies" verify_chain "$WORK/ca-$ca4.pem" "$WORK/cert-$id.pem"
    else fail "issue from the RSA-4096 CA (HTTP $STATUS)"; fi
  fi
  # Serials are unique across everything issued in this run.
  local dup; dup="$(for f in "$WORK"/cert-*.pem; do openssl x509 -in "$f" -noout -serial; done | sort | uniq -d | wc -l)"
  assert "serials are unique ($n+ certificates)" test "$dup" -eq 0
}

check_x509_trpc_parity() {
  need jq || return 0
  local id type alg ca rest_pem trpc_pem
  read -r id type alg < "$WORK/leaf-ids" || { fail "no leaf"; return 0; }
  ca="$(sed -n 1p "$WORK/ca-ids")"
  api GET "/api/v1/certificates/$id" || { fail "REST get certificate (HTTP $STATUS)"; return 0; }
  rest_pem="$(jb .certificatePem)"; local rest_serial; rest_serial="$(jb .serialNumber)"
  trpc_query certificate.getById "{\"id\":\"$id\"}" || { fail "tRPC certificate.getById (HTTP $STATUS: $(body | head -c 200))"; return 0; }
  trpc_pem="$(jb .certificatePem)"
  assert "tRPC and REST return the same certificate PEM" test "$rest_pem" = "$trpc_pem"
  assert "tRPC and REST return the same serial" test "$rest_serial" = "$(jb .serialNumber)"
  trpc_query ca.getById "{\"id\":\"$ca\"}" || { fail "tRPC ca.getById (HTTP $STATUS)"; return 0; }
  local tca; tca="$(jb .certificatePem)"
  api GET "/api/v1/cas/$ca"
  assert "tRPC and REST return the same CA PEM" test "$tca" = "$(jb .certificatePem)"
  trpc_query ca.list '{}' && assert "tRPC ca.list includes the CA" bash -c "jq -e --arg id '$ca' '[.. | objects | select(.id? == \$id)] | length > 0' '$BODY_FILE'"
  if api GET "/api/v1/cas/?limit=100"; then
    assert "REST cas list includes the CA" bash -c "jq -e --arg id '$ca' '[.items[].id] | index(\$id) != null' '$BODY_FILE'"
  else fail "REST cas list (HTTP $STATUS)"; fi
}

check_x509_exports() {
  need openssl jq || return 0
  local id type alg ca f pw="Accept-Export-$RUN_TAG"
  # The first RSA server leaf and the first EC server leaf.
  for alg in RSA-2048 ECDSA-P256; do
    id="$(awk -v a="$alg" '$2=="server" && $3==a {print $1; exit}' "$WORK/leaf-ids")"
    [[ -n "$id" ]] || { fail "no server $alg leaf"; continue; }
    ca="$(sed -n 1p "$WORK/ca-ids")"
    local base="/api/v1/certificates/$id/download?format" leaf="$WORK/cert-$id.pem" d="$WORK/exp-$id"
    mkdir -p "$d"
    download "$base=pem" "$d/c.pem" && assert "$alg pem equals the issued certificate" bash -c "cmp -s <(openssl x509 -in '$d/c.pem') <(openssl x509 -in '$leaf')" || fail "$alg pem (HTTP $STATUS)"
    download "$base=der" "$d/c.der" && assert "$alg der parses and matches" bash -c "openssl x509 -inform der -in '$d/c.der' | cmp -s - <(openssl x509 -in '$leaf')" || fail "$alg der (HTTP $STATUS)"
    if download "$base=chain-pem" "$d/chain.pem"; then
      assert "$alg chain-pem has the leaf and the issuing CA" bash -c "[ \$(grep -c 'BEGIN CERTIFICATE' '$d/chain.pem') -ge 2 ] && grep -qF \"\$(sed -n 2p '$WORK/ca-$ca.pem')\" '$d/chain.pem'"
    else fail "$alg chain-pem (HTTP $STATUS)"; fi
    if download "$base=key-pem" "$d/k.pem"; then
      assert "$alg key-pem matches the certificate public key" bash -c "[ \"\$(openssl pkey -in '$d/k.pem' -pubout | openssl pkey -pubin -outform der | sha256sum)\" = \"\$(openssl x509 -in '$leaf' -noout -pubkey | openssl pkey -pubin -outform der | sha256sum)\" ]"
    else fail "$alg key-pem (HTTP $STATUS)"; fi
    download "$base=pkcs8-pem" "$d/k8.pem" && assert "$alg pkcs8-pem is a PKCS#8 key" grep -q 'BEGIN PRIVATE KEY' "$d/k8.pem" || fail "$alg pkcs8-pem (HTTP $STATUS)"
    if download "$base=full-pem" "$d/full.pem"; then
      assert "$alg full-pem has key, leaf and CA" bash -c "grep -q 'PRIVATE KEY' '$d/full.pem' && [ \$(grep -c 'BEGIN CERTIFICATE' '$d/full.pem') -ge 2 ]"
    else fail "$alg full-pem (HTTP $STATUS)"; fi
    if download "$base=p12" "$d/c.p12" -H "X-Export-Password: $pw"; then
      assert "$alg p12 opens with the password and holds the key and the leaf" bash -c "openssl pkcs12 -in '$d/c.p12' -passin 'pass:$pw' -nodes 2>/dev/null | grep -q 'PRIVATE KEY' && openssl pkcs12 -in '$d/c.p12' -passin 'pass:$pw' -nokeys -clcerts 2>/dev/null | grep -q 'BEGIN CERT'"
      # includeChain defaults to true (OpenAPI): the issuing CA must be in the PKCS#12.
      assert "$alg p12 includes the issuing CA (includeChain default true)" bash -c "[ \$(openssl pkcs12 -in '$d/c.p12' -passin 'pass:$pw' -nokeys 2>/dev/null | grep -c 'BEGIN CERT') -ge 2 ]"
      assert "$alg p12 refuses a wrong password" bash -c "! openssl pkcs12 -in '$d/c.p12' -passin pass:wrong -noout 2>/dev/null"
    else fail "$alg p12 (HTTP $STATUS)"; fi
    if download "$base=p12&legacy=true" "$d/legacy.p12" -H "X-Export-Password: $pw"; then
      assert "$alg legacy p12 opens (OpenSSL -legacy)" bash -c "openssl pkcs12 -legacy -in '$d/legacy.p12' -passin 'pass:$pw' -nodes 2>/dev/null | grep -q 'PRIVATE KEY'"
    else fail "$alg legacy p12 (HTTP $STATUS)"; fi
    if command -v keytool >/dev/null; then
      download "$base=jks-keystore" "$d/k.jks" -H "X-Export-Password: $pw" && \
        assert "$alg jks-keystore lists a PrivateKeyEntry" bash -c "keytool -list -keystore '$d/k.jks' -storepass '$pw' 2>/dev/null | grep -q PrivateKeyEntry" || fail "$alg jks-keystore (HTTP $STATUS)"
      download "$base=jks-truststore" "$d/t.jks" -H "X-Export-Password: $pw" && \
        assert "$alg jks-truststore lists a trustedCertEntry" bash -c "keytool -list -keystore '$d/t.jks' -storepass '$pw' 2>/dev/null | grep -q trustedCertEntry" || fail "$alg jks-truststore (HTTP $STATUS)"
    else skip "keytool missing: JKS formats not checked"; fi
  done
  # CA: public formats work, keystore formats follow ALLOW_CA_KEY_EXPORT (expected: off).
  ca="$(sed -n 1p "$WORK/ca-ids")"
  local cb="/api/v1/cas/$ca/download?format" cd="$WORK/exp-ca"; mkdir -p "$cd"
  download "$cb=der" "$cd/ca.der" && assert "CA der matches the CA PEM" bash -c "openssl x509 -inform der -in '$cd/ca.der' | cmp -s - <(openssl x509 -in '$WORK/ca-$ca.pem')" || fail "CA der (HTTP $STATUS)"
  download "$cb=p12-truststore" "$cd/t.p12" -H "X-Export-Password: $pw" && \
    assert "CA p12-truststore holds the CA certificate" bash -c "openssl pkcs12 -in '$cd/t.p12' -passin 'pass:$pw' -nokeys 2>/dev/null | grep -q 'BEGIN CERT'" || fail "CA p12-truststore (HTTP $STATUS)"
  if [[ "${ACCEPT_EXPECT_CA_KEY_EXPORT:-false}" == true ]]; then
    download "$cb=p12-keystore" "$cd/k.p12" -H "X-Export-Password: $pw" && \
      assert "CA p12-keystore holds the CA key" bash -c "openssl pkcs12 -in '$cd/k.p12' -passin 'pass:$pw' -nodes 2>/dev/null | grep -q 'PRIVATE KEY'" || fail "CA p12-keystore (HTTP $STATUS)"
  else
    api GET "$cb=p12-keystore" "" -H "X-Export-Password: $pw" || true
    assert "CA p12-keystore is refused when CA key export is off (HTTP $STATUS)" test "$STATUS" = 403
  fi
}

check_x509_renew() {
  need openssl jq || return 0
  local id ca new mode
  ca="$(sed -n 1p "$WORK/ca-ids")"
  id="$(awk '$2=="server" && $3=="RSA-2048" {print $1; exit}' "$WORK/leaf-ids")"
  for mode in false true; do
    api POST "/api/v1/certificates/$id/renew" "{\"generateNewKey\":$mode}" || { fail "renew generateNewKey=$mode (HTTP $STATUS: $(body | head -c 300))"; continue; }
    new="$(jb '.id // .certificate.id')"
    api GET "/api/v1/certificates/$new" || { fail "get renewed certificate"; continue; }
    jb .certificatePem > "$WORK/cert-$new.pem"
    assert "renewal (new key: $mode) verifies against the CA" verify_chain "$WORK/ca-$ca.pem" "$WORK/cert-$new.pem"
    assert "renewal (new key: $mode) keeps the subject" test "$(openssl x509 -in "$WORK/cert-$new.pem" -noout -subject)" = "$(openssl x509 -in "$WORK/cert-$id.pem" -noout -subject)"
    assert "renewal (new key: $mode) keeps the SANs" test "$(openssl x509 -in "$WORK/cert-$new.pem" -noout -ext subjectAltName | tail -1)" = "$(openssl x509 -in "$WORK/cert-$id.pem" -noout -ext subjectAltName | tail -1)"
    if [[ $mode == false ]]; then
      assert "renewal without a new key keeps the public key" test "$(pubkey_sha "$WORK/cert-$new.pem")" = "$(pubkey_sha "$WORK/cert-$id.pem")"
    else
      assert "renewal with a new key changes the public key" test "$(pubkey_sha "$WORK/cert-$new.pem")" != "$(pubkey_sha "$WORK/cert-$id.pem")"
      api GET "/api/v1/certificates/$new/download?format=key-pem" && \
        assert "the new key of the renewal is exportable and matches" bash -c "[ \"\$(jq -r .data '$BODY_FILE' | base64 -d | openssl pkey -pubout | openssl pkey -pubin -outform der | sha256sum)\" = \"\$(openssl x509 -in '$WORK/cert-$new.pem' -noout -pubkey | openssl pkey -pubin -outform der | sha256sum)\" ]"
    fi
    id="$new"
  done
  echo "$id" > "$WORK/renewed-id"
}

check_x509_revoke_crl() {
  need openssl jq curl || return 0
  local ca revoked keep serial url
  ca="$(sed -n 1p "$WORK/ca-ids")"
  revoked="$(awk '$2=="client" {print $1; exit}' "$WORK/leaf-ids")"
  keep="$(awk '$2=="dual" {print $1; exit}' "$WORK/leaf-ids")"
  api POST "/api/v1/certificates/$revoked/revoke" '{"reason":"keyCompromise","generateCrl":true}' || { fail "revoke (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  assert "revoke answers status revoked" test "$(jb .status)" = revoked
  echo "$revoked" > "$WORK/revoked-id"
  api GET "/api/v1/certificates/$revoked"
  assert "the certificate reads back as revoked" test "$(jb .status)" = revoked
  serial="$(openssl x509 -in "$WORK/cert-$revoked.pem" -noout -serial | cut -d= -f2)"
  url="$(openssl x509 -in "$WORK/cert-$revoked.pem" -noout -ext crlDistributionPoints | grep -o 'URI:.*' | cut -c5- | head -1)"
  # The CDP URL names the public host of the stack; fetch it through $API.
  local path="/${url#*://*/}" crl="$WORK/ca-$ca.crl"
  curl -fsS "$API$path" -o "$crl" || { fail "fetch the CRL at the CDP path $path"; return 0; }
  pass "CRL served at the CDP path $path"
  [[ "$(head -c 5 "$crl")" == "-----" ]] || openssl crl -inform der -in "$crl" -out "$crl.pem" 2>/dev/null && [[ -f "$crl.pem" ]] && crl="$crl.pem"
  assert "CRL signature verifies with the CA" openssl crl -in "$crl" -CAfile "$WORK/ca-$ca.pem" -noout
  assert "CRL lists the revoked serial" bash -c "openssl crl -in '$crl' -noout -text | grep -qi 'Serial Number: *$serial'"
  assert "CRL gives the reason keyCompromise" bash -c "openssl crl -in '$crl' -noout -text | grep -A6 -i '$serial' | grep -q 'Key Compromise'"
  assert "OpenSSL rejects the revoked certificate with the CRL" bash -c "! openssl verify -crl_check -CAfile '$WORK/ca-$ca.pem' -CRLfile '$crl' '$WORK/cert-$revoked.pem'"
  assert "OpenSSL accepts a good certificate with the CRL" openssl verify -crl_check -CAfile "$WORK/ca-$ca.pem" -CRLfile "$crl" "$WORK/cert-$keep.pem"
  api POST "/api/v1/cas/$ca/crls" '{"nextUpdateDays":3}' && assert "a new CRL has a higher crlNumber" bash -c "[ \$(jq -r .crlNumber '$BODY_FILE') -ge 2 ]" || fail "generate CRL (HTTP $STATUS)"
  api GET "/api/v1/cas/$ca/crls" && pass "CRL history lists $(jq -r '.items // . | length' "$BODY_FILE") CRL(s)" || fail "list CRLs (HTTP $STATUS)"
}

check_x509_external_csr() {
  need openssl jq || return 0
  local ca token d="$WORK/csr" alg
  mkdir -p "$d"
  ca="$(sed -n 1p "$WORK/ca-ids")"
  trpc_mutation integration.register "{\"name\":\"accept-$RUN_TAG\",\"caId\":\"$ca\",\"kind\":\"generic\"}" || { fail "tRPC integration.register (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  token="$(jb .token)"
  assert "integration token minted" bash -c "[[ '$token' == pkimg_* ]]"
  for alg in rsa ec; do
    if [[ $alg == rsa ]]; then openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$d/$alg.key" 2>/dev/null
    else openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$d/$alg.key" 2>/dev/null; fi
    openssl req -new -key "$d/$alg.key" -out "$d/$alg.csr" -subj "/CN=device-$alg.accept.test/O=Acceptance Test/C=ES" \
      -addext "subjectAltName=DNS:device-$alg.accept.test" -addext "extendedKeyUsage=clientAuth" 2>/dev/null
    jq -n --rawfile csr "$d/$alg.csr" --arg uid "accept-$alg-$RUN_TAG" '{csrPem:$csr, requestUid:$uid, durationDays:30}' > "$d/$alg.json"
    ACCEPT_TOKEN="$token" api POST /api/v1/external/sign "$(cat "$d/$alg.json")" || { fail "external sign $alg CSR (HTTP $STATUS: $(body | head -c 300))"; continue; }
    jb .certificatePem > "$d/$alg.pem"
    local s1; s1="$(jb .serialNumber)"
    assert "external $alg CSR: signature verifies against the bound CA" openssl verify -CAfile "$WORK/ca-$ca.pem" "$d/$alg.pem"
    # RFC 5280 4.2.1.1: AKI is required in certificates that are not self-signed (OpenSSL -x509_strict).
    assert "external $alg CSR: certificate passes x509_strict (has AKI)" verify_chain "$WORK/ca-$ca.pem" "$d/$alg.pem"
    assert "external $alg CSR: certificate carries the CSR public key" test "$(openssl req -in "$d/$alg.csr" -noout -pubkey | openssl pkey -pubin -outform der | sha256sum)" = "$(openssl x509 -in "$d/$alg.pem" -noout -pubkey | openssl pkey -pubin -outform der | sha256sum)"
    assert "external $alg CSR: SAN kept" bash -c "openssl x509 -in '$d/$alg.pem' -noout -ext subjectAltName | grep -q 'DNS:device-$alg.accept.test'"
    ACCEPT_TOKEN="$token" api POST /api/v1/external/sign "$(cat "$d/$alg.json")" && \
      assert "external $alg CSR: replay with the same requestUid is idempotent" bash -c "[ \"\$(jq -r .idempotent '$BODY_FILE')\" = true ] && [ \"\$(jq -r .serialNumber '$BODY_FILE')\" = '$s1' ]" || fail "external replay (HTTP $STATUS)"
  done
}
