# SSH checks: user and host CAs, certificates, KRL, and a real OpenSSH login.
# shellcheck shell=bash

SSHW() { echo "$WORK/ssh"; }
ssh_list() { jq -r 'if type=="array" then . else .items end' "$BODY_FILE"; }
ca_fp() { ssh-keygen -lf "$1" | awk '{print $2}'; }
cert_field() { ssh-keygen -Lf "$1" | sed -n "s/^ *$2: *//p" | head -1; }

check_ssh_ca() {
  need ssh-keygen jq curl || return 0
  local d; d="$(SSHW)"; mkdir -p "$d"
  # Each run works in its own zone, so it never collides with the CAs of the default zone.
  local zone="accept-$RUN_TAG"
  api POST /api/v1/ssh/zones "{\"name\":\"$zone\",\"displayName\":\"Release acceptance $RUN_TAG\"}" || { fail "create SSH zone (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  echo "$zone" > "$d/zone"; pass "SSH zone $zone created"
  local t id
  for t in user host; do
    api POST /api/v1/ssh/cas "{\"caType\":\"$t\",\"label\":\"accept-$t-$RUN_TAG\",\"zone\":\"$zone\"}" || { fail "create SSH $t CA (HTTP $STATUS: $(body | head -c 300))"; continue; }
    id="$(jb .id)"; echo "$id" > "$d/$t-ca-id"
    jb .opensshPublicKey > "$d/$t-ca.pub"
    assert "SSH $t CA public key parses" ssh-keygen -lf "$d/$t-ca.pub"
    assert "SSH $t CA fingerprint matches the API" test "$(ca_fp "$d/$t-ca.pub")" = "$(jb .fingerprintSha256)"
    curl -fsS "$API/ssh/cas/$id/ca.pub" -o "$d/$t-ca.public.pub" && \
      assert "public /ssh/cas/<id>/ca.pub serves the same key" test "$(ca_fp "$d/$t-ca.public.pub")" = "$(ca_fp "$d/$t-ca.pub")" || fail "GET /ssh/cas/$id/ca.pub"
  done
  curl -fsS "$API/ssh/zones/$zone/trusted-user-ca-keys" -o "$d/trusted" && \
    assert "zone trusted-user-ca-keys lists the user CA" grep -qF "$(awk '{print $2}' "$d/user-ca.pub" 2>/dev/null)" "$d/trusted" || fail "GET /ssh/zones/$zone/trusted-user-ca-keys"
  curl -fsS "$API/ssh/zones/$zone/cert-authority" -o "$d/known" && \
    assert "zone cert-authority lists the host CA" grep -qF "$(awk '{print $2}' "$d/host-ca.pub" 2>/dev/null)" "$d/known" || fail "GET /ssh/zones/$zone/cert-authority"
}

check_ssh_user_host() {
  need ssh-keygen jq || return 0
  local d; d="$(SSHW)"; mkdir -p "$d"
  local uca hca; uca="$(cat "$d/user-ca-id" 2>/dev/null)"; hca="$(cat "$d/host-ca-id" 2>/dev/null)"
  [[ -n "$uca" && -n "$hca" ]] || { fail "no SSH CAs from ssh_ca"; return 0; }
  local ident prin zone; zone="$(cat "$d/zone")"
  api POST /api/v1/ssh/identities "{\"subject\":\"accept-alice-$RUN_TAG\",\"email\":\"alice-$RUN_TAG@accept.test\",\"zone\":\"$zone\"}" || { fail "create identity (HTTP $STATUS: $(body | head -c 200))"; return 0; }
  ident="$(jb .id)"
  api POST /api/v1/ssh/principals "{\"name\":\"acc$RUN_TAG\",\"zone\":\"$zone\"}" || { fail "create principal (HTTP $STATUS: $(body | head -c 200))"; return 0; }
  prin="$(jb .id)"; echo "acc$RUN_TAG" > "$d/principal"
  api POST /api/v1/ssh/principals/grant "{\"identityId\":\"$ident\",\"principalId\":\"$prin\"}" && pass "principal granted to the identity" || fail "grant (HTTP $STATUS)"
  # Two user keys (ed25519, ecdsa): cert "a" is revoked by ssh_krl, cert "b" logs in.
  local k t
  for k in a b; do
    t=ed25519; [[ $k == b ]] && t=ecdsa
    ssh-keygen -q -t "$t" -N '' -C "accept-$k" -f "$d/user-$k"
    jq -cn --arg i "$ident" --arg ca "$uca" --arg key "$(cat "$d/user-$k.pub")" --arg p "acc$RUN_TAG" \
      '{identityId:$i, caId:$ca, sshPublicKey:$key, principals:[$p], validForSeconds:3600, enforceEntitlement:true}' > "$d/issue-$k.json"
    api POST /api/v1/ssh/users/issue "$(cat "$d/issue-$k.json")" || { fail "issue user cert $k (HTTP $STATUS: $(body | head -c 300))"; continue; }
    jb .cert.certOpenssh > "$d/user-$k-cert.pub"; jb .cert.id > "$d/user-$k-cert-id"
    assert "user cert $k ($t) is a user certificate" bash -c "ssh-keygen -Lf '$d/user-$k-cert.pub' | grep -q 'Type: .*user certificate'"
    assert "user cert $k is signed by the user CA" test "$(cert_field "$d/user-$k-cert.pub" 'Signing CA' | awk '{print $2}')" = "$(ca_fp "$d/user-ca.pub")"
    assert "user cert $k has the granted principal" bash -c "ssh-keygen -Lf '$d/user-$k-cert.pub' | sed -n '/Principals:/,/Critical/p' | grep -qx ' *acc$RUN_TAG'"
    assert "user cert $k certifies the submitted key" test "$(ssh-keygen -lf "$d/user-$k-cert.pub" | awk '{print $2}')" = "$(ssh-keygen -lf "$d/user-$k.pub" | awk '{print $2}')"
  done
  # A principal that is not granted is refused when the entitlement is enforced.
  jq -c --arg p "notgranted$RUN_TAG" '.principals=[$p]' "$d/issue-b.json" > "$d/issue-x.json"
  api POST /api/v1/ssh/users/issue "$(cat "$d/issue-x.json")" || true
  assert "user cert with a principal that is not granted is refused (HTTP $STATUS)" bash -c "[[ '$STATUS' == 4* ]]"
  # Host certificate for the key of the sshd container.
  ssh-keygen -q -t ecdsa -b 256 -N '' -C accept-host -f "$d/host"
  local hreq; hreq="$(jq -cn --arg key "$(cat "$d/host.pub")" --arg f "accept-$RUN_TAG.host.test" --arg z "$zone" '{fqdn:$f, addresses:["127.0.0.1"], opensshHostPubkey:$key, zone:$z}')"
  api POST /api/v1/ssh/hosts "$hreq" || { fail "register host (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  local host; host="$(jb .id)"; echo "$host" > "$d/host-id"
  api POST /api/v1/ssh/hosts/issue "{\"hostId\":\"$host\",\"caId\":\"$hca\",\"validForSeconds\":3600}" || { fail "issue host cert (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  jb .cert.certOpenssh > "$d/host-cert.pub"
  assert "host cert is a host certificate" bash -c "ssh-keygen -Lf '$d/host-cert.pub' | grep -q 'Type: .*host certificate'"
  assert "host cert is signed by the host CA" test "$(cert_field "$d/host-cert.pub" 'Signing CA' | awk '{print $2}')" = "$(ca_fp "$d/host-ca.pub")"
  assert "host cert names the FQDN and the address" bash -c "ssh-keygen -Lf '$d/host-cert.pub' | sed -n '/Principals:/,/Critical/p' | grep -q 'accept-$RUN_TAG.host.test' && ssh-keygen -Lf '$d/host-cert.pub' | sed -n '/Principals:/,/Critical/p' | grep -q '127.0.0.1'"
  curl -fsS "$API/ssh/hosts/$host/cert.pub" -o "$d/host-cert.public.pub" && \
    assert "public /ssh/hosts/<id>/cert.pub serves the host certificate" test "$(awk '{print $2}' "$d/host-cert.public.pub")" = "$(awk '{print $2}' "$d/host-cert.pub")" || fail "GET /ssh/hosts/$host/cert.pub"
}

check_ssh_krl() {
  need ssh-keygen jq curl || return 0
  local d; d="$(SSHW)"
  local uca cert; uca="$(cat "$d/user-ca-id" 2>/dev/null)"; cert="$(cat "$d/user-a-cert-id" 2>/dev/null)"
  [[ -n "$uca" && -n "$cert" ]] || { fail "no user cert from ssh_user_host"; return 0; }
  api POST "/api/v1/ssh/certs/$cert/revoke" '{"reason":"acceptance: key compromise"}' && pass "user cert a revoked" || { fail "revoke SSH cert (HTTP $STATUS: $(body | head -c 300))"; return 0; }
  # Authenticated download and the public one: both must hold the revocation.
  api GET "/api/v1/ssh/cas/$uca/krl.bin" "" -o /dev/null || true
  curl -fsS ${ACCEPT_TOKEN:+-H "Authorization: Bearer $ACCEPT_TOKEN"} "$API/api/v1/ssh/cas/$uca/krl.bin" -o "$d/krl.bin" || { fail "GET /api/v1/ssh/cas/<id>/krl.bin"; return 0; }
  pass "KRL downloaded ($(wc -c < "$d/krl.bin") bytes)"
  assert "ssh-keygen -Q reports cert a as revoked" bash -c "! ssh-keygen -Qf '$d/krl.bin' '$d/user-a-cert.pub'"
  assert "ssh-keygen -Q accepts cert b" ssh-keygen -Qf "$d/krl.bin" "$d/user-b-cert.pub"
  if curl -fsS "$API/krl/$uca.bin" -o "$d/krl.public.bin"; then
    assert "public /krl/<ca>.bin also revokes cert a" bash -c "! ssh-keygen -Qf '$d/krl.public.bin' '$d/user-a-cert.pub'"
  else skip "public /krl/<ca>.bin not served (SSH_HOST_KRL_PUBLIC off?)"; fi
  if curl -fsS "$API/krl/$uca.json" -o "$d/krl.json"; then
    pass "KRL metadata: $(jq -c '{version: (.version // .krlVersion), revoked: (.revokedCount // .count)}' "$d/krl.json" 2>/dev/null)"
  fi
}

# A real sshd (container) trusts the user CA, presents the host certificate and uses the KRL.
check_ssh_sshd() {
  need docker ssh ssh-keygen || return 0
  local d; d="$(SSHW)"
  [[ -f "$d/user-b-cert.pub" && -f "$d/host-cert.pub" && -f "$d/krl.bin" ]] || { fail "needs ssh_user_host and ssh_krl"; return 0; }
  docker image inspect pki-accept-sshd:local >/dev/null 2>&1 || docker build -q -t pki-accept-sshd:local "$(dirname "${BASH_SOURCE[0]}")/../sshd" >/dev/null \
    || { fail "build the sshd image"; return 0; }
  local c="$d/sshd"; mkdir -p "$c"
  cp "$d/host" "$c/host_key"; cp "$d/host-cert.pub" "$c/host_key-cert.pub"; cp "$d/user-ca.pub" "$c/user_ca.pub"; cp "$d/krl.bin" "$c/krl"
  cat "$d/principal" > "$c/principals"
  cat > "$c/sshd_config" <<EOF
Port 2222
HostKey /etc/ssh/accept/host_key
HostCertificate /etc/ssh/accept/host_key-cert.pub
TrustedUserCAKeys /etc/ssh/accept/user_ca.pub
AuthorizedPrincipalsFile /etc/ssh/accept/principals
RevokedKeys /etc/ssh/accept/krl
AuthorizedKeysFile none
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
LogLevel VERBOSE
EOF
  chmod 0600 "$c/host_key"; chmod 0644 "$c"/*.pub "$c/principals" "$c/sshd_config" "$c/krl"
  local name="pki-accept-sshd-$RUN_TAG"
  # sshd refuses a host key that another user can read, and reads the principals file as
  # the login user: copy the files in as root, folder 755, host key 600.
  docker create --name "$name" -p 127.0.0.1::2222 pki-accept-sshd:local >/dev/null
  docker cp "$c/." "$name:/etc/ssh/accept/" && docker start "$name" >/dev/null
  docker exec -u 0 "$name" sh -c 'chown -R root:root /etc/ssh/accept && chmod 755 /etc/ssh/accept && chmod 600 /etc/ssh/accept/host_key'
  local port; port="$(docker port "$name" 2222/tcp | head -1 | awk -F: '{print $NF}')"
  sleep 1
  printf '@cert-authority [127.0.0.1]:%s %s\n' "$port" "$(cat "$d/host-ca.pub")" > "$c/known_hosts"
  local sshopts=(-p "$port" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$c/known_hosts" -o ConnectTimeout=10)
  assert "sshd: cert b logs in with host-CA verification (strict known_hosts)" \
    ssh "${sshopts[@]}" -i "$d/user-b" -o CertificateFile="$d/user-b-cert.pub" acc@127.0.0.1 'echo accept-ok'
  assert "sshd: revoked cert a is refused (KRL)" bash -c "! ssh ${sshopts[*]} -i '$d/user-a' -o CertificateFile='$d/user-a-cert.pub' acc@127.0.0.1 true"
  assert "sshd: the plain key without a certificate is refused" bash -c "! ssh ${sshopts[*]} -i '$d/user-b' -o CertificateFile=/dev/null acc@127.0.0.1 true"
  # A host that is not certified by the host CA fails strict host key checking.
  printf '@cert-authority [127.0.0.1]:%s %s\n' "$port" "$(cat "$d/user-ca.pub")" > "$c/wrong_known_hosts"
  # ssh keeps the first value of an option: give the other known_hosts first.
  assert "client refuses the host when known_hosts trusts another CA" bash -c "! ssh -o UserKnownHostsFile='$c/wrong_known_hosts' ${sshopts[*]} -i '$d/user-b' -o CertificateFile='$d/user-b-cert.pub' acc@127.0.0.1 true"
  docker logs "$name" > "$OUT/sshd.log" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
}
