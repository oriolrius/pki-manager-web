# Backup and restore: copy the whole state (SQLite + key store volumes) of a stopped stack, start a
# fresh stack from the copy, and prove that the restored stack has the same identities AND the same
# private keys (fresh signatures verify against the trust material taken before the backup).
# shellcheck shell=bash

check_backup_restore() {
  [[ ${#STACK[@]} -gt 0 ]] || { skip "ACCEPT_STACK=none: the runner does not own the stack, no backup/restore"; return 0; }
  need openssl jq ssh-keygen || return 0
  local b="$WORK/backup" bdir="$OUT/backup" ca rev
  mkdir -p "$b"
  ca="$(sed -n 1p "$WORK/ca-ids" 2>/dev/null)"; rev="$(cat "$WORK/revoked-id" 2>/dev/null)"
  [[ -n "$ca" ]] || { fail "needs the x509 checks first"; return 0; }

  # 1. What must survive.
  api GET "/api/v1/cas/?limit=100" || { fail "list CAs (HTTP $STATUS)"; return 0; }
  jq -S '[.items[] | {id, serialNumber, status}] | sort_by(.id)' "$BODY_FILE" > "$b/cas.before"
  api GET "/api/v1/certificates/?limit=100" && jq -S '[.items[] | {id, serialNumber, status}] | sort_by(.id)' "$BODY_FILE" > "$b/certs.before"
  local sshd="$WORK/ssh" uca=""
  [[ -f "$sshd/user-ca-id" ]] && uca="$(cat "$sshd/user-ca-id")"

  # 2. Backup (the stack is stopped while its volumes are copied), then restore into a new project.
  if stack backup "$bdir" >"$OUT/backup.log" 2>&1; then pass "backup: $(grep -c . "$bdir/SHA256SUMS") volume archive(s) with checksums"
  else fail "backup ($(tail -3 "$OUT/backup.log" | tr '\n' ' '))"; return 0; fi
  if stack restore "$bdir" >"$OUT/restore.log" 2>&1; then pass "restore: fresh project $(stack project) is healthy"
  else fail "restore ($(tail -5 "$OUT/restore.log" | tr '\n' ' '))"; return 0; fi
  stack images > "$OUT/images-restored.txt" || true

  # 3. Same records.
  api GET "/api/v1/cas/?limit=100" && jq -S '[.items[] | {id, serialNumber, status}] | sort_by(.id)' "$BODY_FILE" > "$b/cas.after"
  assert "restored: same CAs (ids, serials, status)" cmp -s "$b/cas.before" "$b/cas.after"
  api GET "/api/v1/certificates/?limit=100" && jq -S '[.items[] | {id, serialNumber, status}] | sort_by(.id)' "$BODY_FILE" > "$b/certs.after"
  assert "restored: same certificates (ids, serials, status)" cmp -s "$b/certs.before" "$b/certs.after"
  if [[ -n "$rev" ]]; then
    api GET "/api/v1/certificates/$rev" && assert "restored: the revoked certificate is still revoked" test "$(jb .status)" = revoked
  fi

  # 4. Same keys: new signatures from the restored stack verify with the trust taken before.
  local id
  if id="$(issue "$ca" server ECDSA-P256 "after-restore.accept.test" '{"sanDns":["after-restore.accept.test"]}')"; then
    assert "restored X.509 CA signs a new leaf that verifies with the pre-backup CA certificate" verify_chain "$WORK/ca-$ca.pem" "$WORK/cert-$id.pem"
  else fail "issue after restore (HTTP $STATUS: $(body | head -c 300))"; fi
  if api POST "/api/v1/cas/$ca/crls" '{"nextUpdateDays":2}'; then
    curl -fsS "$API/crl/$ca.crl" -o "$b/after.crl" || true
    local crl="$b/after.crl"
    [[ "$(head -c 5 "$crl" 2>/dev/null)" == "-----" ]] || { openssl crl -inform der -in "$crl" -out "$crl.pem" 2>/dev/null && crl="$crl.pem"; }
    assert "restored CA signs a CRL that verifies with the pre-backup CA certificate" openssl crl -in "$crl" -CAfile "$WORK/ca-$ca.pem" -noout
    if [[ -n "$rev" ]]; then
      local serial; serial="$(openssl x509 -in "$WORK/cert-$rev.pem" -noout -serial | cut -d= -f2)"
      assert "the new CRL still lists the revoked serial" bash -c "openssl crl -in '$crl' -noout -text | grep -qi 'Serial Number: *$serial'"
    fi
  else fail "generate CRL after restore (HTTP $STATUS)"; fi
  local renewed; renewed="$(cat "$WORK/renewed-id" 2>/dev/null)"
  if [[ -n "$renewed" ]] && api GET "/api/v1/certificates/$renewed/download?format=key-pem"; then
    jq -r .data "$BODY_FILE" | base64 -d > "$b/leaf.key"
    assert "restored leaf private key still matches its certificate" bash -c "[ \"\$(openssl pkey -in '$b/leaf.key' -pubout | openssl pkey -pubin -outform der | sha256sum)\" = \"\$(openssl x509 -in '$WORK/cert-$renewed.pem' -noout -pubkey | openssl pkey -pubin -outform der | sha256sum)\" ]"
  fi
  if [[ -n "$uca" && -f "$sshd/issue-b.json" ]]; then
    if api POST /api/v1/ssh/users/issue "$(cat "$sshd/issue-b.json")"; then
      jb .cert.certOpenssh > "$b/user-cert.pub"
      assert "restored SSH user CA signs with the same CA key" test "$(ssh-keygen -Lf "$b/user-cert.pub" | sed -n 's/^ *Signing CA: *//p' | awk '{print $2}')" = "$(ssh-keygen -lf "$sshd/user-ca.pub" | awk '{print $2}')"
      # Same sshd trust as before the backup: the new certificate logs in.
      if [[ -f "$sshd/sshd/sshd_config" ]] && command -v docker >/dev/null; then
        cp "$b/user-cert.pub" "$sshd/user-b-cert.pub"
        CHECK_SUFFIX=" (after restore)" check_ssh_sshd_login_only
      fi
    else fail "SSH issue after restore (HTTP $STATUS: $(body | head -c 300))"; fi
    curl -fsS "$API/krl/$uca.bin" -o "$b/krl.bin" && \
      assert "restored KRL still revokes cert a" bash -c "! ssh-keygen -Qf '$b/krl.bin' '$sshd/user-a-cert.pub'" || true
  fi
}

# Login only, against the same sshd configuration (used after a restore).
check_ssh_sshd_login_only() {
  local d="$WORK/ssh" c="$WORK/ssh/sshd" name="pki-accept-sshd-$RUN_TAG"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker create --name "$name" -p 127.0.0.1::2222 pki-accept-sshd:local >/dev/null
  docker cp "$c/." "$name:/etc/ssh/accept/" && docker start "$name" >/dev/null
  docker exec -u 0 "$name" sh -c 'chown -R root:root /etc/ssh/accept && chmod 755 /etc/ssh/accept && chmod 600 /etc/ssh/accept/host_key'
  local port; port="$(docker port "$name" 2222/tcp | head -1 | awk -F: '{print $NF}')"
  sleep 1
  printf '@cert-authority [127.0.0.1]:%s %s\n' "$port" "$(cat "$d/host-ca.pub")" > "$c/known_hosts"
  assert "sshd: a certificate from the restored CA logs in${CHECK_SUFFIX:-}" \
    ssh -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$c/known_hosts" \
      -o ConnectTimeout=10 -i "$d/user-b" -o CertificateFile="$d/user-b-cert.pub" acc@127.0.0.1 true
  docker rm -f "$name" >/dev/null 2>&1 || true
}
