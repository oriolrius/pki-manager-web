import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, privateEncrypt, publicEncrypt, constants, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import {
  OpenBaoConfigError, OpenBaoError, OpenBaoRATransit, OpenBaoResponseError, checkOpenBaoRAConfig, checkRAKeyPolicy,
  defaultRAKeyProvider, loadOpenBaoConfig, verifyDigestSignature,
} from './ra-transit.js';

const DIGEST_INFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');

/** Self-signed TLS certificate for 127.0.0.1 (node-forge; no OpenSSL CLI). */
function tlsIdentity(cn: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = '0' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60e3); cert.validity.notAfter = new Date(Date.now() + 86400e3);
  cert.setSubject([{ name: 'commonName', value: cn }]); cert.setIssuer([{ name: 'commonName', value: cn }]);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), forge.md.sha256.create());
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), cert: forge.pki.certificateToPem(cert) };
}

type FakeKey = { priv: KeyObject; pub: KeyObject; policy: Record<string, unknown> };
const keys = new Map<string, FakeKey>();
const seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: Record<string, unknown> }> = [];
const tamper: { signatureVersion?: number; signature?: string; sessionKeyLength?: number; sessionKeyVersion?: number; status?: number; policy?: Record<string, unknown> } = {};

function keyResponse(k: FakeKey) {
  return { data: { type: 'rsa-3072', exportable: false, allow_plaintext_backup: false, allow_pkcs1v15_session_key: true, derived: false,
    deletion_allowed: false, latest_version: 1, min_decryption_version: 1, min_available_version: 0,
    keys: { 1: { public_key: k.pub.export({ type: 'spki', format: 'pem' }).toString() } }, ...k.policy, ...tamper.policy } };
}

describe('OpenBao RA Transit client', () => {
  let server: Server; let dir: string; let env: NodeJS.ProcessEnv; let transit: OpenBaoRATransit;
  const name = `scep-ra-${randomUUID()}`;
  beforeAll(async () => {
    const identity = tlsIdentity('fake-openbao');
    dir = mkdtempSync(join(tmpdir(), 'openbao-ra-test-'));
    writeFileSync(join(dir, 'ca.pem'), identity.cert); writeFileSync(join(dir, 'token'), 's.test-token-0123456789\n');
    server = createServer({ key: identity.key, cert: identity.cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c)); req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        const send = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
        if (tamper.status) return send(tamper.status, { errors: ['permission denied: secret detail'] });
        const m = /^\/v1\/pki-manager-ra\/(keys|sign|session-key\/pkcs1v15)\/([^/]+)(\/sha2-256)?$/.exec(req.url!);
        if (!m || req.headers['x-vault-token'] !== 's.test-token-0123456789') return send(403, { errors: ['permission denied'] });
        const key = keys.get(m[2]);
        if (m[1] === 'keys' && req.method === 'GET') return key ? send(200, keyResponse(key)) : send(404, { errors: [] });
        if (m[1] === 'keys' && req.method === 'POST') {
          if (!key) { const kp = generateKeyPairSync('rsa', { modulusLength: 3072 }); keys.set(m[2], { priv: kp.privateKey, pub: kp.publicKey, policy: {} }); }
          return send(200, { data: {} });
        }
        if (!key) return send(400, { errors: ['encryption key not found'] });
        if (m[1] === 'sign') {
          const digest = Buffer.from(body.input, 'base64');
          const sig = privateEncrypt({ key: key.priv, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([DIGEST_INFO, digest]));
          return send(200, { data: { signature: `vault:v${tamper.signatureVersion ?? body.key_version}:${tamper.signature ?? sig.toString('base64')}`, key_version: body.key_version } });
        }
        // Node blocks RSA PKCS#1 v1.5 private decryption; node-forge does it for the fake.
        const forgeKey = forge.pki.privateKeyFromPem(key.priv.export({ type: 'pkcs8', format: 'pem' }).toString());
        const plain = Buffer.from(forgeKey.decrypt(Buffer.from(body.ciphertext, 'base64').toString('binary'), 'RSAES-PKCS1-V1_5'), 'binary');
        const sessionKey = tamper.sessionKeyLength ? Buffer.alloc(tamper.sessionKeyLength, 1) : plain;
        return send(200, { data: { session_key: sessionKey.toString('base64'), key_version: tamper.sessionKeyVersion ?? body.key_version } });
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    env = { OPENBAO_ADDR: `https://127.0.0.1:${port}`, OPENBAO_CACERT: join(dir, 'ca.pem'), OPENBAO_TOKEN_FILE: join(dir, 'token'), OPENBAO_NAMESPACE: 'pki/ns1' };
    transit = new OpenBaoRATransit(loadOpenBaoConfig(env));
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => { seen.length = 0; for (const k of Object.keys(tamper)) delete (tamper as Record<string, unknown>)[k]; });

  it('validates the provider and OpenBao settings', () => {
    expect(defaultRAKeyProvider({})).toBe('cosmian');
    expect(defaultRAKeyProvider({ SCEP_RA_KEY_PROVIDER: 'openbao' })).toBe('openbao');
    expect(() => defaultRAKeyProvider({ SCEP_RA_KEY_PROVIDER: 'vault' })).toThrow(OpenBaoConfigError);
    expect(checkOpenBaoRAConfig(0, {})).toBe('cosmian');
    expect(() => checkOpenBaoRAConfig(1, {})).toThrow('OPENBAO_ADDR');
    expect(() => checkOpenBaoRAConfig(0, { SCEP_RA_KEY_PROVIDER: 'openbao' })).toThrow('OPENBAO_ADDR');
    for (const addr of ['http://127.0.0.1:8200', 'https://u:p@bao:8200', 'https://bao:8200/v1', 'https://bao:8200/?x=1', 'not a url']) {
      expect(() => loadOpenBaoConfig({ ...env, OPENBAO_ADDR: addr }), addr).toThrow(OpenBaoConfigError);
    }
    expect(() => loadOpenBaoConfig({ ...env, OPENBAO_TOKEN_FILE: 'token' })).toThrow('absolute');
    expect(() => loadOpenBaoConfig({ ...env, OPENBAO_CACERT: join(dir, 'token') })).toThrow('OPENBAO_CACERT');
    expect(() => loadOpenBaoConfig({ ...env, OPENBAO_RA_MOUNT: '../sys' })).toThrow('OPENBAO_RA_MOUNT');
    expect(() => loadOpenBaoConfig({ ...env, OPENBAO_TIMEOUT_MS: '10' })).toThrow('OPENBAO_TIMEOUT_MS');
    expect(loadOpenBaoConfig(env).mount).toBe('pki-manager-ra');
  });

  it('creates a non-exportable, opted-in RSA-3072 key once and reads it back', async () => {
    const pub = await transit.ensureKey(name, 1);
    expect(pub.asymmetricKeyDetails?.modulusLength).toBe(3072);
    const create = seen.find(r => r.method === 'POST');
    expect(create?.url).toBe(`/v1/pki-manager-ra/keys/${name}`);
    expect(create?.body).toEqual({ type: 'rsa-3072', exportable: false, allow_plaintext_backup: false, allow_pkcs1v15_session_key: true, auto_rotate_period: 0 });
    expect(seen.every(r => r.headers['x-vault-namespace'] === 'pki/ns1' && r.headers['x-vault-request'] === 'true')).toBe(true);
    seen.length = 0;
    await transit.ensureKey(name, 1);
    expect(seen.map(r => r.method)).toEqual(['GET']);
  });

  it('rejects key names that the backend did not generate, before any request', async () => {
    for (const bad of ['scep-ra-x', '../keys/other', `scep-ra-${randomUUID()}/config`, 'ca-key']) {
      await expect(transit.readKey(bad, 1)).rejects.toThrow(OpenBaoResponseError);
    }
    expect(seen).toHaveLength(0);
  });

  it('refuses a key whose policy allows export, backup, deletion or lacks the opt-in', async () => {
    for (const policy of [{ exportable: true }, { allow_plaintext_backup: true }, { allow_pkcs1v15_session_key: false }, { deletion_allowed: true },
      { imported_key: true }, { soft_deleted: true }, { type: 'rsa-2048' }, { derived: true }, { min_decryption_version: 2 }, { min_available_version: 2 }, { latest_version: 0 }, { keys: {} }]) {
      tamper.policy = policy;
      await expect(transit.readKey(name, 1), JSON.stringify(policy)).rejects.toThrow(OpenBaoResponseError);
    }
    expect(() => checkRAKeyPolicy(undefined, 1)).toThrow(OpenBaoResponseError);
  });

  it('signs a digest with the fixed version and checks the signature locally', async () => {
    const pub = (await transit.readKey(name, 1))!;
    const digest = randomBytes(32);
    const sig = await transit.signDigest(name, 1, digest, pub);
    expect(verifyDigestSignature(pub, digest, sig)).toBe(true);
    const req = seen.find(r => r.url.includes('/sign/'))!;
    expect(req.url).toBe(`/v1/pki-manager-ra/sign/${name}/sha2-256`);
    expect(req.body).toEqual({ input: digest.toString('base64'), prehashed: true, signature_algorithm: 'pkcs1v15', key_version: 1 });
    tamper.signatureVersion = 2;
    await expect(transit.signDigest(name, 1, digest, pub)).rejects.toThrow('version');
    delete tamper.signatureVersion; tamper.signature = Buffer.alloc(384, 9).toString('base64');
    await expect(transit.signDigest(name, 1, digest, pub)).rejects.toThrow('verify');
    tamper.signature = 'AAAA AAAA';
    await expect(transit.signDigest(name, 1, digest, pub)).rejects.toThrow('base64');
    const other = generateKeyPairSync('rsa', { modulusLength: 3072 }).publicKey;
    delete tamper.signature;
    await expect(transit.signDigest(name, 1, digest, other)).rejects.toThrow('verify');
  });

  it('unwraps a CMS session key of exactly the expected length', async () => {
    const pub = (await transit.readKey(name, 1))!;
    for (const length of [16, 24, 32] as const) {
      const sessionKey = randomBytes(length);
      const wrapped = publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_PADDING }, sessionKey);
      expect((await transit.unwrapSessionKey(name, 1, wrapped, length)).equals(sessionKey)).toBe(true);
      expect(seen.at(-1)?.body).toEqual({ ciphertext: wrapped.toString('base64'), key_version: 1, session_key_length: length });
    }
    const wrapped = publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_PADDING }, randomBytes(32));
    tamper.sessionKeyLength = 16;
    await expect(transit.unwrapSessionKey(name, 1, wrapped, 32)).rejects.toThrow('length');
    delete tamper.sessionKeyLength; tamper.sessionKeyVersion = 2;
    await expect(transit.unwrapSessionKey(name, 1, wrapped, 32)).rejects.toThrow('version');
    await expect(transit.unwrapSessionKey(name, 1, Buffer.alloc(256), 32)).rejects.toThrow('RSA-3072');
  });

  it('keeps OpenBao error text out of the error message', async () => {
    tamper.status = 403;
    const error = await transit.readKey(name, 1).catch(e => e);
    expect(error).toBeInstanceOf(OpenBaoError);
    expect(error.status).toBe(403);
    expect(error.message).not.toContain('secret detail');
    expect(error.detail).toContain('secret detail');
  });

  it('refuses a server that the pinned CA does not trust, and a bad token file', async () => {
    const unpinned = new OpenBaoRATransit(loadOpenBaoConfig({ ...env, OPENBAO_CACERT: undefined }));
    const error = await unpinned.readKey(name, 1).catch(e => e);
    expect(error).toBeInstanceOf(OpenBaoError); expect(error.status).toBe(0);
    writeFileSync(join(dir, 'bad-token'), 'not a token\n');
    const badToken = new OpenBaoRATransit(loadOpenBaoConfig({ ...env, OPENBAO_TOKEN_FILE: join(dir, 'bad-token') }));
    await expect(badToken.readKey(name, 1)).rejects.toThrow(OpenBaoError);
    expect(seen).toHaveLength(0);
  });
});
