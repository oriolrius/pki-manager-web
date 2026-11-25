/**
 * Property-based tests for the SSH parsers: the OpenSSH public key line (request
 * body of the host / user / CA endpoints), the wire format, the certificate
 * subject key, and the ECIES envelope of the encrypted KRL.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
  ecPointToOpenSshEcdsa,
  parseSshPublicKey,
  sshFingerprint,
  SshPublicKeyError,
  subjectPubkeyFromCert,
} from './pubkey.js';
import { SshReader, SshWriter, encodeOptions, encodeStringList } from './wire.js';
import { assembleSshCert, buildSshCertTbs } from './openssh-cert.js';
import { eciesDecryptV1, eciesEncryptV1, EciesError, ECIES_EPH_LEN, ECIES_NONCE_LEN, ECIES_TAG_LEN } from './ecies.js';
import { NUM_RUNS, SLOW_NUM_RUNS, anyString, hostileString } from '../../test/property.js';

const bytes = (min: number, max: number) => fc.uint8Array({ minLength: min, maxLength: max }).map((u) => Buffer.from(u));
const comment = fc.string({ unit: fc.constantFrom(...'abcXYZ019@.-_'.split('')), maxLength: 20 });

const ed25519Line = bytes(32, 32).map((pk) => ({
  pk,
  line: `ssh-ed25519 ${new SshWriter().string('ssh-ed25519').string(pk).build().toString('base64')}`,
}));
/** 0x04 and 64 bytes: the parser checks the form of the point, not the curve. */
const ecPoint = bytes(64, 64).map((xy) => Buffer.concat([Buffer.from([0x04]), xy]));

/** A valid line with one change. */
const nearLine = fc.tuple(ed25519Line, fc.nat(), hostileString(3)).map(([{ line }, at, insert]) => {
  const i = at % (line.length + 1);
  return line.slice(0, i) + insert + line.slice(i + (at % 2));
});
/** The declared algorithm with a random blob. */
const randomBlob = fc
  .tuple(fc.constantFrom('ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa', 'ssh-dss', 'sk-ssh-ed25519@openssh.com'), bytes(0, 120))
  .map(([algo, blob]) => `${algo} ${blob.toString('base64')}`);
/** A blob with the right algorithm name, then random bytes. */
const rightPrefix = fc
  .tuple(fc.constantFrom('ssh-ed25519', 'ecdsa-sha2-nistp256'), bytes(0, 120))
  .map(([algo, rest]) => `${algo} ${Buffer.concat([new SshWriter().string(algo).build(), rest]).toString('base64')}`);

describe('parseSshPublicKey (property)', () => {
  it('returns a key or throws SshPublicKeyError: no other error for any text', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(), hostileString(80), nearLine, randomBlob, rightPrefix), (line) => {
        let parsed;
        try {
          parsed = parseSshPublicKey(line);
        } catch (error) {
          expect(error).toBeInstanceOf(SshPublicKeyError);
          return;
        }
        // An accepted key is complete and agrees with its own blob.
        expect(['ssh-ed25519', 'ecdsa-sha2-nistp256']).toContain(parsed.algo);
        expect(new SshReader(parsed.blob).cstring()).toBe(parsed.algo);
        expect(parsed.fingerprintSha256).toBe(sshFingerprint(parsed.blob));
        if (parsed.algo === 'ssh-ed25519') expect(parsed.ed25519?.pk).toHaveLength(32);
        else {
          expect(parsed.ecdsa?.curve).toBe('nistp256');
          expect(parsed.ecdsa?.q).toHaveLength(65);
          expect(parsed.ecdsa?.q[0]).toBe(0x04);
        }
      }),
      { numRuns: NUM_RUNS * 3 },
    );
  });

  it('round trip: an ed25519 line gives back its key and its comment', () => {
    fc.assert(
      fc.property(ed25519Line, comment, fc.constantFrom('', ' ', '\t', '\n'), ({ pk, line }, text, pad) => {
        const parsed = parseSshPublicKey(pad + (text ? `${line} ${text}` : line) + pad);
        expect(parsed.algo).toBe('ssh-ed25519');
        expect(parsed.ed25519?.pk.equals(pk)).toBe(true);
        expect(parsed.comment).toBe(text);
        // Parse -> serialize -> parse gives the same blob.
        expect(parseSshPublicKey(`${parsed.algo} ${parsed.blob.toString('base64')}`).blob.equals(parsed.blob)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round trip: an EC point gives an ecdsa line that parses to the same point', () => {
    fc.assert(
      fc.property(ecPoint, comment, (q, text) => {
        const parsed = parseSshPublicKey(ecPointToOpenSshEcdsa(q, text));
        expect(parsed.algo).toBe('ecdsa-sha2-nistp256');
        expect(parsed.ecdsa?.q.equals(q)).toBe(true);
        expect(parsed.comment).toBe(text);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ecPointToOpenSshEcdsa refuses a buffer that is not an uncompressed point', () => {
    fc.assert(
      fc.property(bytes(0, 80), (q) => {
        fc.pre(!(q.length === 65 && q[0] === 0x04));
        expect(() => ecPointToOpenSshEcdsa(q)).toThrow(SshPublicKeyError);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('subjectPubkeyFromCert (property)', () => {
  it('returns a line or throws SshPublicKeyError: no other error for any text', () => {
    const certPrefix = fc
      .tuple(fc.constantFrom('ssh-ed25519-cert-v01@openssh.com', 'ecdsa-sha2-nistp256-cert-v01@openssh.com'), bytes(0, 120))
      .map(([type, rest]) => `${type} ${Buffer.concat([new SshWriter().string(type).build(), rest]).toString('base64')}`);
    fc.assert(
      fc.property(fc.oneof(anyString(), nearLine, randomBlob, certPrefix), (line) => {
        try {
          expect(typeof subjectPubkeyFromCert(line)).toBe('string');
        } catch (error) {
          expect(error).toBeInstanceOf(SshPublicKeyError);
        }
      }),
      { numRuns: NUM_RUNS * 2 },
    );
  });

  it('round trip: the subject key of a certificate is the key it was made for', () => {
    const principal = fc.string({ unit: fc.constantFrom(...'abcxyz019.-_'.split('')), minLength: 1, maxLength: 16 });
    const subject = fc.oneof(
      ed25519Line.map(({ line }) => line),
      ecPoint.map((q) => ecPointToOpenSshEcdsa(q)),
    );
    fc.assert(
      fc.property(
        subject,
        fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
        fc.constantFrom('user', 'host') as fc.Arbitrary<'user' | 'host'>,
        fc.array(principal, { minLength: 1, maxLength: 4 }),
        bytes(1, 80),
        bytes(1, 100),
        (line, serial, type, principals, caBlob, signature) => {
          const subjectKey = parseSshPublicKey(line);
          const { tbs, certType } = buildSshCertTbs({
            subjectKey,
            caPublicKeyBlob: caBlob,
            serial,
            type,
            keyId: 'property-test',
            principals,
            validAfter: 1n,
            validBefore: 2n,
          });
          const cert = assembleSshCert(tbs, signature, certType, 'comment');
          expect(subjectPubkeyFromCert(cert.line)).toBe(line);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('SSH wire format (property)', () => {
  type Field = { kind: 'u32'; v: number } | { kind: 'u64'; v: bigint } | { kind: 'str'; v: Buffer };
  const field: fc.Arbitrary<Field> = fc.oneof(
    fc.integer({ min: 0, max: 0xffffffff }).map((v) => ({ kind: 'u32' as const, v })),
    fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((v) => ({ kind: 'u64' as const, v })),
    bytes(0, 40).map((v) => ({ kind: 'str' as const, v })),
  );

  it('SshReader reads back what SshWriter wrote', () => {
    fc.assert(
      fc.property(fc.array(field, { maxLength: 12 }), (fields) => {
        const w = new SshWriter();
        for (const f of fields) {
          if (f.kind === 'u32') w.uint32(f.v);
          else if (f.kind === 'u64') w.uint64(f.v);
          else w.string(f.v);
        }
        const r = new SshReader(w.build());
        for (const f of fields) {
          if (f.kind === 'u32') expect(r.uint32()).toBe(f.v);
          else if (f.kind === 'u64') expect(r.uint64()).toBe(f.v);
          else expect(r.string().equals(f.v)).toBe(true);
        }
        expect(r.atEnd()).toBe(true);
        expect(r.remaining).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('SshReader.string never reads past the end of the buffer', () => {
    fc.assert(
      fc.property(bytes(0, 60), (buf) => {
        const r = new SshReader(buf);
        try {
          for (let i = 0; i < 20 && !r.atEnd(); i++) {
            const s = r.string();
            expect(s.length).toBeLessThanOrEqual(buf.length);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        expect(r.bytesRead).toBeLessThanOrEqual(buf.length + 4);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('encodeStringList and encodeOptions decode to the same names, options sorted by name', () => {
    const name = fc.string({ unit: fc.constantFrom(...'abcxyz-@.'.split('')), minLength: 1, maxLength: 12 });
    fc.assert(
      fc.property(fc.uniqueArray(name, { maxLength: 8 }), (names) => {
        const list = new SshReader(encodeStringList(names));
        for (const n of names) expect(list.cstring()).toBe(n);
        expect(list.atEnd()).toBe(true);

        const options = new SshReader(encodeOptions(names.map((n) => ({ name: n }))));
        const decoded: string[] = [];
        while (!options.atEnd()) {
          decoded.push(options.cstring());
          expect(options.string()).toHaveLength(0);
        }
        expect(decoded).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('ECIES v1 envelope (property)', () => {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = keyPair.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const q = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const hostLine = ecPointToOpenSshEcdsa(q, 'host');
  const privateKey: KeyObject = keyPair.privateKey;

  it('round trip: decrypt gives the plaintext, and a change of one bit is refused', () => {
    fc.assert(
      fc.property(bytes(0, 300), fc.nat(), fc.integer({ min: 0, max: 7 }), (plaintext, at, bit) => {
        const envelope = eciesEncryptV1(hostLine, plaintext);
        expect(envelope).toHaveLength(ECIES_EPH_LEN + ECIES_NONCE_LEN + plaintext.length + ECIES_TAG_LEN);
        expect(eciesDecryptV1(privateKey, envelope).equals(plaintext)).toBe(true);
        const tampered = Buffer.from(envelope);
        tampered[at % tampered.length] ^= 1 << bit;
        expect(() => eciesDecryptV1(privateKey, tampered)).toThrow();
      }),
      { numRuns: SLOW_NUM_RUNS * 3 },
    );
  });

  it('refuses every envelope that it did not make', () => {
    fc.assert(
      fc.property(fc.oneof(bytes(0, 200), bytes(64, 160).map((rest) => Buffer.concat([Buffer.from([0x04]), rest]))), (envelope) => {
        expect(() => eciesDecryptV1(privateKey, envelope)).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('eciesEncryptV1 refuses a key that is not an ecdsa-sha2-nistp256 public key', () => {
    fc.assert(
      fc.property(fc.oneof(anyString(80), ed25519Line.map(({ line }) => line), randomBlob), (line) => {
        try {
          eciesEncryptV1(line, Buffer.from('x'));
        } catch (error) {
          expect(error instanceof EciesError || error instanceof SshPublicKeyError).toBe(true);
          return;
        }
        expect(parseSshPublicKey(line).algo).toBe('ecdsa-sha2-nistp256');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
