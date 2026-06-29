# SSH KRL Distributor (host-side puller)

Host-side puller for the PKI-Manager **SSH KRL distribution** path (SSH-24).
The encrypted, stateless distribution endpoint lives in the backend
(`POST /api/v1/external/ssh/krl`); this is the client a fleet host runs on a
timer to keep `/etc/ssh/revoked_keys` current.

## Security model — decryption is proof of identity

The endpoint returns a **per-host ECIES ciphertext** encrypted to the host's
KMS-registered public key (decision-013 — verified viable against the live KMS).
Only the host that owns the matching private key can decrypt it. Layered:

1. **Confidentiality** — ECIES to the host's public key (hides *which* keys are revoked).
2. **Authenticity** — the bare KRL is signed by the CA key (detached DER signature),
   verified by the puller with the **CA public key**. Note: sshd itself does **not**
   verify any signature on `RevokedKeys` — the public bare KRL (`/krl/:caId.bin`)
   relies on TLS + `0444` root-owned perms; the detached signature is an extra
   guarantee for this puller only.
3. **Freshness / anti-rollback** — `valid_until` inside the ciphertext, plus the
   puller refuses any version not strictly newer than the installed one.
4. **host_id binding** — echoed inside the ciphertext to detect misdirected payloads.

The CA private key never leaves the KMS; the host private (ECIES) key is
KMS-resident and used only for `ec decrypt`. `host_id` travels in the request
**body**, never the URL.

## Deploy

```bash
sudo install -m 755 host_puller.sh /usr/local/sbin/host_puller.sh
sudo install -m 644 krl-puller.service krl-puller.timer /etc/systemd/system/
sudo tee /etc/krl-puller.env >/dev/null <<'EOF'
KRL_API_URL=https://pki.internal/api/v1/external/ssh/krl
HOST_ID=server.lab.local
HOST_PRIV_KEY_ID=<this host's KMS ECIES private key id>   # from register-host-pubkey
CA_PUBLIC_KEY_ID=<Host CA public key id>
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now krl-puller.timer
```

Register the host's ECIES key (returns `HOST_PRIV_KEY_ID`) via the manager:

```bash
curl -fsS -X POST https://pki.internal/api/v1/external/ssh/register-host-pubkey \
  -H "Authorization: Bearer pkimg_…" -H 'Content-Type: application/json' \
  --data '{"fqdn":"server.lab.local"}'
```

(The backend must run with `SSH_ECIES_ENABLED=true` to serve the encrypted path.)

## Prerequisites

`curl`, `jq`, `base64`, `sha256sum`, `install`, and the `cosmian` CLI configured
for your KMS. **NTP is a hard requirement** — certificate validity and KRL
freshness both depend on an accurate clock.
