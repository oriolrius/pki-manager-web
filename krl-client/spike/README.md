# KRLC-02a — native P-256 ECIES round-trip spike

**Outcome: GO (feasible).** A payload encrypted by the **backend** with `node:crypto`
(to a host's OpenSSH `ecdsa-sha2-nistp256` **public** key) is decrypted **locally on the
host** by a Go program using only the OpenSSH **private** key
(`/etc/ssh/ssh_host_ecdsa_key`, via `ssh.ParseRawPrivateKey` → `crypto/ecdh`) — **no KMS,
no network, no `cosmian` CLI**. This validates the local-decrypt model of KRLC-02 /
decision-015 and pins the wire format both sides implement.

This mirrors decision-013's TASK-144 spike (which validated the *now-superseded* KMS-resident
model); here we validate the replacement.

## Result matrix

| Probe | Expected | Result |
|---|---|---|
| node encrypt (to `ecdsa` pubkey) → go decrypt (local privkey) → byte-identical | plaintext recovered exactly | **PASS** (same SHA-256) |
| Load OpenSSH `ssh_host_ecdsa_key` in Go and use for ECDH | works | **PASS** (`ssh.ParseRawPrivateKey` → `*ecdsa.PrivateKey.ECDH()`) |
| Parse OpenSSH `ecdsa-sha2-nistp256 AAAA…` pubkey in node | works | **PASS** (SSH-wire parse → JWK → `KeyObject`) |
| Tampered ciphertext | reject (exit 4) | **PASS** (AES-GCM auth fails) |
| Wrong host key | reject (exit 4) | **PASS** |
| ed25519 key (not P-256) | reject (exit 3) | **PASS** (clear "not an ecdsa key") |

Reproduce: `./run.sh` (needs `node >= 20`, `go >= 1.24`, `ssh-keygen`). Built/tested on **go 1.26.4**.

## Pinned wire format — ECIES v1 (the interop contract for KRLC-02 + KRLC-04)

```
envelope = ephemeralPub(65) || nonce(12) || ciphertext(N) || tag(16)
```

| Field | Size | Notes |
|---|---|---|
| `ephemeralPub` | 65 B | SEC1 **uncompressed** P-256 point `0x04 ‖ X(32) ‖ Y(32)` |
| `nonce` | 12 B | AES-GCM IV, random per message |
| `ciphertext` | N B | AES-256-GCM ciphertext (same length as plaintext) |
| `tag` | 16 B | AES-256-GCM authentication tag |

Key derivation and AEAD:

```
shared = ECDH(ephemeralPriv, recipientPub)          # 32 B, SEC1 X coordinate only
key    = HKDF-SHA256(ikm = shared,
                     salt = "pki-manager-krl-ecies-v1",   # fixed ASCII, 24 B
                     info = ephemeralPub,                  # the 65 B above (channel binding)
                     L    = 32)
ciphertext‖tag = AES-256-GCM(key, nonce, plaintext, aad = <empty>)
```

Both ends must agree byte-for-byte on: uncompressed point encoding, the ECDH secret being
the **X coordinate only** (Node `crypto.diffieHellman` and Go `ecdh` both do this), the
HKDF `salt`/`info`, and empty AAD. Verified interoperable between `node:crypto` and Go
`crypto/*` here.

> Hardening notes for the real implementation (out of scope for the spike): consider binding
> `host_id` (and/or `krl_version`) into the GCM **AAD** so a payload can't be replayed to a
> different host at the crypto layer; the client already checks `host_id`/`valid_until` above
> the envelope. `salt`/`info`/version are fixed here — bump an explicit version byte if the
> scheme ever changes.

## Build & toolchain (feeds KRLC-01 / KRLC-12)

Built and tested on **go 1.26.4** with **`golang.org/x/crypto v0.53.0`**. `crypto/hkdf` is used
from the **standard library** (Go ≥ 1.24), so the ONLY external dependency is
`golang.org/x/crypto/ssh` (for `ParseRawPrivateKey`; `crypto/ecdh`, `crypto/ecdsa`, `crypto/aes` are
all stdlib). **KRLC-01 targets the latest Go (1.26)** — an intentional divergence from `k8s/issuer`
(Go 1.23) that pins the newest toolchain and sidesteps the `x/crypto`-vs-Go version constraint
(`x/crypto v0.50+` requires Go ≥ 1.25).

## Files

- `encrypt.mjs` — backend side (Node): encrypt to an OpenSSH ecdsa pubkey.
- `decrypt.go` — host side (Go): decrypt locally with the OpenSSH ecdsa privkey (stdlib `crypto/hkdf`).
- `run.sh` — end-to-end + negative tests.
- `go.mod` / `go.sum` — go 1.26, `x/crypto v0.53.0` (only `x/crypto/ssh` is external).
