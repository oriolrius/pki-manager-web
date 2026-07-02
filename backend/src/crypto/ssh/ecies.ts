/**
 * Native ECIES v1 for per-host KRL distribution (KRLC-02, decision-015) — the
 * LOCAL-decrypt model: pki-manager encrypts the KRL payload to a host's OWN
 * OpenSSH ecdsa-sha2-nistp256 public key so the host decrypts entirely locally
 * with /etc/ssh/ssh_host_ecdsa_key. The KMS is NOT involved in en/decryption.
 *
 * Envelope (pinned v1 — proven interoperable node:crypto <-> Go crypto in the
 * KRLC-02a spike, see krl-client/spike/README.md):
 *
 *   envelope = ephemeralPub(65) || nonce(12) || ciphertext(N) || tag(16)
 *   shared   = ECDH(ephemeralPriv, recipientPub)         # 32B, SEC1 X coordinate only
 *   key      = HKDF-SHA256(ikm=shared, salt=SALT, info=ephemeralPub, L=32)
 *   ct||tag  = AES-256-GCM(key, nonce, plaintext, aad=<empty>)
 *
 * `ephemeralPub` is the SEC1 uncompressed point (0x04 ‖ X(32) ‖ Y(32)). The Go
 * client (KRLC-04) implements the same framing. Pure node:crypto — no KMS, no
 * cosmian, no extra npm deps.
 */
import {
  createPublicKey,
  generateKeyPairSync,
  diffieHellman,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { parseSshPublicKey } from './pubkey.js';

export class EciesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EciesError';
  }
}

/** Fixed HKDF salt — must match the Go client and the KRLC-02a spike verbatim. */
export const ECIES_V1_SALT = Buffer.from('pki-manager-krl-ecies-v1');
export const ECIES_EPH_LEN = 65;
export const ECIES_NONCE_LEN = 12;
export const ECIES_TAG_LEN = 16;
const ECIES_MIN_LEN = ECIES_EPH_LEN + ECIES_NONCE_LEN + ECIES_TAG_LEN;

/** A 65-byte uncompressed P-256 point -> EC public KeyObject (via JWK). */
function pointToPublicKey(q: Buffer): KeyObject {
  if (q.length !== ECIES_EPH_LEN || q[0] !== 0x04) {
    throw new EciesError('expected a 65-byte uncompressed P-256 point (0x04 ‖ X ‖ Y)');
  }
  return createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: q.subarray(1, 33).toString('base64url'),
      y: q.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

/**
 * ECIES v1 encrypt to a host's OpenSSH ecdsa-sha2-nistp256 public key line
 * (the value stored in ssh_hosts.opensshHostPubkey). Throws EciesError if the
 * key is not an ECDSA nistp256 key (e.g. ed25519 — cannot do P-256 ECIES).
 */
export function eciesEncryptV1(opensshEcdsaPubkey: string, plaintext: Buffer): Buffer {
  const parsed = parseSshPublicKey(opensshEcdsaPubkey);
  if (parsed.algo !== 'ecdsa-sha2-nistp256' || !parsed.ecdsa) {
    throw new EciesError(
      `ECIES requires an ecdsa-sha2-nistp256 host key, but this host uses '${parsed.algo}' — register the host's ecdsa host key for encrypted KRL distribution`
    );
  }
  const recipient = pointToPublicKey(parsed.ecdsa.q);

  const eph = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ej = eph.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const ephPub = Buffer.concat([Buffer.from([0x04]), Buffer.from(ej.x, 'base64url'), Buffer.from(ej.y, 'base64url')]);
  if (ephPub.length !== ECIES_EPH_LEN) throw new EciesError('bad ephemeral point length');

  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, ECIES_V1_SALT, ephPub, 32));

  const nonce = randomBytes(ECIES_NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([ephPub, nonce, ct, tag]);
}

/**
 * ECIES v1 decrypt — the inverse of eciesEncryptV1, for tests and parity with
 * the Go host client. `recipientPrivate` is the host's EC P-256 private key as a
 * node KeyObject (the real host does this in Go with its OpenSSH host key).
 */
export function eciesDecryptV1(recipientPrivate: KeyObject, envelope: Buffer): Buffer {
  if (envelope.length < ECIES_MIN_LEN) throw new EciesError(`envelope too short: ${envelope.length} bytes`);
  const ephPub = envelope.subarray(0, ECIES_EPH_LEN);
  const nonce = envelope.subarray(ECIES_EPH_LEN, ECIES_EPH_LEN + ECIES_NONCE_LEN);
  const ct = envelope.subarray(ECIES_EPH_LEN + ECIES_NONCE_LEN, envelope.length - ECIES_TAG_LEN);
  const tag = envelope.subarray(envelope.length - ECIES_TAG_LEN);

  const shared = diffieHellman({ privateKey: recipientPrivate, publicKey: pointToPublicKey(Buffer.from(ephPub)) });
  const key = Buffer.from(hkdfSync('sha256', shared, ECIES_V1_SALT, ephPub, 32));

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
