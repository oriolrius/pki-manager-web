/**
 * REST key and key store downloads with no `openssl` on the backend PATH (live key store).
 *
 * The backend PATH has only `java` and `keytool`. The test side reads every file with an
 * independent openssl and keytool (absolute paths). PKCS#12 bundles with a private key are the
 * one export that still needs openssl: without it the route answers 500, with it the file keeps
 * the subject DN as friendlyName. SKIPPED without a key store (scripts/openbao-test.sh up).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { registerRestApi } from '../index.js';
import { appRouter } from '../../trpc/router.js';
import { createContext } from '../../trpc/context.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { isKmsAvailable } from '../../test/kms-helper.js';

const which = (cmd: string): string | null => {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};
const OPENSSL = which('openssl');
const KEYTOOL = which('keytool');
const JAVA = which('java');
const password = `Pä-${randomBytes(9).toString('hex')}`;

describe.skipIf(!OPENSSL || !KEYTOOL || !JAVA)('REST key store downloads without openssl on PATH', () => {
  let live = false;
  let server: FastifyInstance;
  let dir: string;
  let bin: string;
  let savedPath: string | undefined;
  let caId: string;
  let certId: string;
  let leafPem: string;

  const file = (name: string, data: string | Buffer) => {
    const f = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
    writeFileSync(f, data);
    return f;
  };
  const download = async (url: string) => {
    const res = await server.inject({ method: 'GET', url, headers: { 'x-export-password': password } });
    return { status: res.statusCode, body: JSON.parse(res.body) as { data?: string; error?: { message?: string } } };
  };
  const keytoolList = (b64: string, type: 'JKS' | 'PKCS12', pass: string) =>
    execFileSync(KEYTOOL!, ['-list', '-v', '-keystore', file('s', Buffer.from(b64, 'base64')), '-storetype', type, '-storepass:env', 'KS'], {
      encoding: 'utf8', env: { ...process.env, KS: pass, LC_ALL: 'C.UTF-8' },
    });

  beforeAll(async () => {
    live = await isKmsAvailable();
    if (!live) return;
    dir = mkdtempSync(join(tmpdir(), 'pki-rest-export-'));
    bin = join(dir, 'bin');
    mkdirSync(bin);
    symlinkSync(JAVA!, join(bin, 'java'));
    symlinkSync(KEYTOOL!, join(bin, 'keytool'));

    server = Fastify({ logger: false });
    await registerRestApi(server);
    await server.ready();

    const caller = appRouter.createCaller(await createContext({ req: {} as FastifyRequest, res: {} as FastifyReply }));
    const rnd = Math.random().toString(36).slice(2, 8);
    const ca = await caller.ca.create({
      subject: { commonName: `No OpenSSL CA ${rnd}`, organization: 'Export Test', country: 'ES' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 2,
    });
    caId = ca.id;
    const cert = await caller.certificate.issue({
      caId,
      certificateType: 'server',
      subject: { commonName: `no-openssl-${rnd}.example.com`, organization: 'Export Test', country: 'ES' },
      keyAlgorithm: 'ECDSA-P256',
      validityDays: 30,
      sanDns: [`no-openssl-${rnd}.example.com`],
    });
    certId = cert.id;
    leafPem = cert.certificatePem!;

    savedPath = process.env.PATH;
    process.env.PATH = bin;
  });

  afterAll(async () => {
    if (savedPath !== undefined) process.env.PATH = savedPath;
    if (certId) await db.delete(certificates).where(eq(certificates.id, certId)).catch(() => {});
    if (caId) await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).catch(() => {});
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('pkcs8-encrypted: openssl decrypts the EC key with the export password', async (ctx) => {
    if (!live) return ctx.skip();
    const res = await download(`/api/v1/certificates/${certId}/download?format=pkcs8-encrypted`);
    expect(res.status).toBe(200);
    const pem = Buffer.from(res.body.data!, 'base64').toString('utf8');
    const pub = execFileSync(OPENSSL!, ['pkey', '-in', file('k.pem', pem), '-passin', 'env:P', '-pubout'], {
      encoding: 'utf8', env: { ...process.env, P: password },
    });
    expect(pub).toBe(new X509Certificate(leafPem).publicKey.export({ type: 'spki', format: 'pem' }));
    expect(createPublicKey(pub).asymmetricKeyType).toBe('ec');
  });

  it('jks-keystore: keytool reads the EC PrivateKeyEntry and its CA chain', async (ctx) => {
    if (!live) return ctx.skip();
    const res = await download(`/api/v1/certificates/${certId}/download?format=jks-keystore`);
    expect(res.status).toBe(200);
    const list = keytoolList(res.body.data!, 'JKS', password);
    expect(list).toContain('Entry type: PrivateKeyEntry');
    expect(list).toContain('Certificate chain length: 2');
  });

  it('jks-truststore and CA p12-truststore: keytool reads a trustedCertEntry', async (ctx) => {
    if (!live) return ctx.skip();
    const jks = await download(`/api/v1/certificates/${certId}/download?format=jks-truststore`);
    expect(jks.status).toBe(200);
    expect(keytoolList(jks.body.data!, 'JKS', password)).toContain('Entry type: trustedCertEntry');

    const p12 = await download(`/api/v1/cas/${caId}/download?format=p12-truststore`);
    expect(p12.status).toBe(200);
    expect(keytoolList(p12.body.data!, 'PKCS12', password)).toContain('Entry type: trustedCertEntry');
    const info = spawnSync(OPENSSL!, ['pkcs12', '-in', file('t.p12', Buffer.from(p12.body.data!, 'base64')), '-info', '-nokeys', '-passin', 'env:P'], {
      encoding: 'utf8', env: { ...process.env, P: password },
    });
    expect(info.status).toBe(0);
    expect(info.stderr).toMatch(/PBES2, PBKDF2, AES-256-CBC/);

    // Legacy 3DES and a non-ASCII password: Java cannot encode it, so the route fails, as before.
    const legacy = await download(`/api/v1/cas/${caId}/download?format=p12-truststore&legacy=true`);
    expect(legacy.status).toBe(500);
  });

  it('p12 with a private key: 500 without openssl, a full bundle with it', async (ctx) => {
    if (!live) return ctx.skip();
    const without = await download(`/api/v1/certificates/${certId}/download?format=p12`);
    expect(without.status).toBe(500);

    process.env.PATH = `${bin}:${dirname(OPENSSL!)}`;
    try {
      const res = await download(`/api/v1/certificates/${certId}/download?format=p12`);
      expect(res.status).toBe(200);
      const out = spawnSync(OPENSSL!, ['pkcs12', '-in', file('b.p12', Buffer.from(res.body.data!, 'base64')), '-nodes', '-passin', 'env:P'], {
        encoding: 'utf8', env: { ...process.env, P: password },
      });
      expect(out.status).toBe(0);
      const subject = (await db.select().from(certificates).where(eq(certificates.id, certId)))[0].subjectDn;
      expect(out.stdout).toContain(`friendlyName: ${subject}`);
      expect(out.stdout.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(2);
      expect(out.stdout).toContain('-----BEGIN PRIVATE KEY-----');
    } finally {
      process.env.PATH = bin;
    }
  });
});
