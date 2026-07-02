// KRLC-02a spike — BACKEND side (Node, mirrors what pki-manager's node:crypto
// would do). ECIES v1 encrypt to a host's OpenSSH ecdsa-sha2-nistp256 PUBLIC key.
//
// Envelope (pinned v1) — see README.md:
//   ephemeralPub(65B uncompressed 0x04||X||Y) || nonce(12B) || ciphertext || tag(16B)
//   shared = ECDH_x(ephemeralPriv, recipientPub)            (32B SEC1 X coordinate)
//   key    = HKDF-SHA256(ikm=shared, salt=SALT, info=ephemeralPub, L=32)
//   ct||tag= AES-256-GCM(key, nonce, plaintext, aad=<empty>)
//
// Usage: node encrypt.mjs <openssh_pubkey_file> <plaintext_file> > envelope.bin
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const SALT = Buffer.from('pki-manager-krl-ecies-v1');

/** Parse an OpenSSH "ecdsa-sha2-nistp256 AAAA... comment" line to its 65B point Q. */
function parseOpenSSHEcdsaPoint(line) {
  const b64 = line.trim().split(/\s+/)[1];
  if (!b64) throw new Error('malformed OpenSSH public key line');
  const buf = Buffer.from(b64, 'base64');
  let off = 0;
  const readStr = () => {
    const len = buf.readUInt32BE(off); off += 4;
    const s = buf.subarray(off, off + len); off += len; return s;
  };
  const keyType = readStr().toString('ascii');
  const curve = readStr().toString('ascii');
  const Q = readStr();
  if (keyType !== 'ecdsa-sha2-nistp256') throw new Error(`unsupported key type: ${keyType}`);
  if (curve !== 'nistp256') throw new Error(`unsupported curve: ${curve}`);
  if (Q.length !== 65 || Q[0] !== 0x04) throw new Error('expected 65B uncompressed EC point');
  return Q;
}

/** 65B uncompressed point -> EC public KeyObject (via JWK; no OpenSSH parser in node:crypto). */
function pointToPublicKey(Q) {
  return crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256',
      x: Q.subarray(1, 33).toString('base64url'),
      y: Q.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
}

const recipientPub = pointToPublicKey(parseOpenSSHEcdsaPoint(readFileSync(process.argv[2], 'utf8')));
const plaintext = readFileSync(process.argv[3]);

const eph = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ej = eph.publicKey.export({ format: 'jwk' });
const ephPub = Buffer.concat([Buffer.from([0x04]), Buffer.from(ej.x, 'base64url'), Buffer.from(ej.y, 'base64url')]);
if (ephPub.length !== 65) throw new Error('bad ephemeral point length');

const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub });
const key = Buffer.from(crypto.hkdfSync('sha256', shared, SALT, ephPub, 32));

const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

process.stderr.write(`[encrypt] shared=${shared.length}B key=${key.length}B nonce=${nonce.length}B ct=${ct.length}B tag=${tag.length}B\n`);
process.stdout.write(Buffer.concat([ephPub, nonce, ct, tag]));
