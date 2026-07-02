# krl-client integration test vectors (KRLC-11 / TASK-169)

`golden/` holds a **self-consistent, backend-produced** bundle used by the
integration tests in `internal/app` to prove real cross-implementation interop:

```
backend eciesEncryptV1 (node:crypto)  →  Go decrypt.Open        (ciphertext.bin → payload.json)
backend ECDSA-P256 DER signature      →  Go verify.Check         (ca_signature.der under ca.pub)
real `ssh-keygen -k` bare KRL         →  Go installer  →  `ssh-keygen -Q`  (revoked_keys.krl)
```

Because the ciphertext and the CA OpenSSH pubkey line are emitted by the **actual
backend source** (not a Go re-implementation), these vectors guard the wire
contract: if the backend envelope, the signature scheme, or the KRL framing ever
drifts, the Go tests fail.

## Files

| File | What it is |
|---|---|
| `ssh_host_ecdsa_key` / `.pub` | Host `ecdsa-sha2-nistp256` key. Private = the Go client's `--host-key`; public = the ECIES recipient the backend encrypts to. |
| `ca.pub` | CA public key as an OpenSSH `authorized_keys` line (the `TrustedUserCAKeys` shape `verify.LoadCAKeys` reads). |
| `ca_signature.der` | Detached ECDSA-P256/DER CA signature over `sha256(revoked_keys.krl)`. |
| `revoked_keys.krl` | A **real** OpenSSH bare KRL (format 1, `ssh-keygen -k`) revoking `revoked_id.pub`. |
| `revoked_id` / `.pub`, `valid_id` / `.pub` | Two ed25519 user keys — one revoked by the KRL, one not — targeted by `ssh-keygen -Q`. |
| `payload.json` | The exact decrypted plaintext the ciphertext wraps (`krl`, `ca_signature`, `krl_version`, `krl_number`, `valid_until`, `host_id`). |
| `ciphertext.bin` | The backend `eciesEncryptV1` envelope the fake PKI-Manager serves at `200`. |
| `meta.json` | Test-facing metadata: `host_id`, `krl_version`, `krl_number`, `krl_sha256`. |

> All keys here are **throwaway test material** — generated per regeneration and
> never used outside this suite.

## Regenerate

From the repo root (needs backend deps installed + `ssh-keygen` on `PATH`):

```bash
backend/node_modules/.bin/tsx \
  krl-client/internal/app/testdata/gen/generate-golden.mts
```

The generator (`gen/generate-golden.mts`) imports `eciesEncryptV1` and
`spkiToOpenSshEcdsa` from the backend verbatim. The ECIES ephemeral key, nonce,
and the ECDSA signature are randomized, so a regeneration produces a fresh but
equally-valid bundle.
