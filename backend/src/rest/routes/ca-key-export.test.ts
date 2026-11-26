/**
 * CA private-key export control (ALLOW_CA_KEY_EXPORT).
 *
 * - default (flag unset/false): keystore formats are refused with 403 CA_KEY_EXPORT_DISABLED
 * - flag true: admin may export; a non-admin is refused (OIDC on); every attempt is audited
 * - certificate-only formats keep working regardless of the flag
 *
 * Uses a real KMS (skipped when it is not available).
 */
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { registerRestApi } from '../index.js';
import { appRouter } from '../../trpc/router.js';
import { createContext } from '../../trpc/context.js';
import { db } from '../../db/client.js';
import { auditLog, certificateAuthorities } from '../../db/schema.js';
import { installAuditActorContext } from '../../lib/audit-actor.js';
import { isKmsAvailable } from '../../test/kms-helper.js';

const oidc = vi.hoisted(() => ({ enabled: false }));

vi.mock('../../lib/oidc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/oidc.js')>();
  return { ...actual, isOIDCEnabled: () => oidc.enabled };
});

// With OIDC "on", the bearer token is simply the role of the caller.
vi.mock('../../lib/jwt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/jwt.js')>();
  return {
    ...actual,
    validateAuthHeader: async (header: string | undefined) => {
      const role = header?.replace('Bearer ', '') ?? '';
      return { sub: `sub-${role}`, preferredUsername: role, roles: [role] };
    },
  };
});

describe('CA private key export control', () => {
  let server: FastifyInstance;
  let caId: string;
  let kmsAvailable = false;

  const download = (format: string, token?: string) =>
    server.inject({
      method: 'GET',
      url: `/api/v1/cas/${caId}/download?format=${format}&password=Export-Pass-123`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const auditRows = (status: 'success' | 'failure') =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.operation, 'ca.export_private_key'),
          eq(auditLog.entityId, caId),
          eq(auditLog.status, status)
        )
      )
      .all();

  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    if (!kmsAvailable) return;
    server = Fastify({ logger: false });
    installAuditActorContext(server);
    await registerRestApi(server);
    await server.ready();

    const caller = appRouter.createCaller(
      await createContext({ req: {} as FastifyRequest, res: {} as FastifyReply })
    );
    const ca = await caller.ca.create({
      subject: { commonName: `KeyExport Test CA ${Date.now()}`, organization: 'KeyExport Org', country: 'US' },
      keyAlgorithm: 'RSA-2048',
      validityYears: 1,
    });
    caId = ca.id;
  });

  afterEach(() => {
    delete process.env.ALLOW_CA_KEY_EXPORT;
    oidc.enabled = false;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (caId) {
      await db.delete(auditLog).where(eq(auditLog.entityId, caId)).execute().catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    }
  });

  it.each(['p12-keystore', 'jks-keystore'])('blocks %s by default (403 CA_KEY_EXPORT_DISABLED) and audits it', async (format) => {
    if (!kmsAvailable) return;
    const before = auditRows('failure').length;
    const res = await download(format);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CA_KEY_EXPORT_DISABLED');
    expect(auditRows('failure').length).toBe(before + 1);
  });

  it('blocks keystores when the flag is explicitly false, even for an admin', async () => {
    if (!kmsAvailable) return;
    process.env.ALLOW_CA_KEY_EXPORT = 'false';
    oidc.enabled = true;
    const res = await download('p12-keystore', 'admin');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CA_KEY_EXPORT_DISABLED');
  });

  it('keeps certificate-only formats available while export is disabled', async () => {
    if (!kmsAvailable) return;
    for (const format of ['pem', 'der', 'p12-truststore', 'jks-truststore']) {
      const res = await download(format);
      expect(res.statusCode, format).toBe(200);
    }
  });

  it.for([false, true])('exports only the CA certificate in a PKCS#12 truststore (legacy=%s)', async (legacy, ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const res = await download(legacy ? 'p12-truststore&legacy=true' : 'p12-truststore');
    expect(res.statusCode).toBe(200);
    const result = spawnSync('openssl', ['pkcs12', '-info', '-noout', '-passin', 'pass:Export-Pass-123'], {
      input: Buffer.from(res.json().data, 'base64'), encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`MAC: ${legacy ? 'sha1' : 'sha256'},`);
    expect(result.stderr).toContain(legacy ? 'pbeWithSHA1And3-KeyTripleDES-CBC' : 'PBES2, PBKDF2, AES-256-CBC');
    expect(result.stderr.match(/Certificate bag/g)).toHaveLength(1);
    expect(result.stderr).not.toMatch(/keybag/i);
  });

  it.each(['p12-keystore', 'jks-keystore'])('lets an admin export %s when enabled and audits success', async (format) => {
    if (!kmsAvailable) return;
    process.env.ALLOW_CA_KEY_EXPORT = 'true';
    oidc.enabled = true;
    const before = auditRows('success').length;
    const res = await download(format, 'admin');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toBeTruthy();
    const rows = auditRows('success');
    expect(rows.length).toBe(before + 1);
    expect(rows.some((r) => r.actorName === 'admin' && r.actorType === 'user')).toBe(true);
  });

  it('refuses a non-admin when enabled (403 CA_KEY_EXPORT_ADMIN_REQUIRED) and audits it', async () => {
    if (!kmsAvailable) return;
    process.env.ALLOW_CA_KEY_EXPORT = 'true';
    oidc.enabled = true;
    const before = auditRows('failure').length;
    const res = await download('p12-keystore', 'viewer');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CA_KEY_EXPORT_ADMIN_REQUIRED');
    expect(auditRows('failure').length).toBe(before + 1);
  });

  it('exposes the policy to the UI through ca.keyExportPolicy', async () => {
    const caller = appRouter.createCaller({ db, req: { ip: '127.0.0.1', headers: {} } } as never);
    expect(await caller.ca.keyExportPolicy()).toEqual({ enabled: false, allowed: false });
    process.env.ALLOW_CA_KEY_EXPORT = 'true';
    expect(await caller.ca.keyExportPolicy()).toEqual({ enabled: true, allowed: true });
    oidc.enabled = true;
    const viewer = appRouter.createCaller({ db, req: { ip: '127.0.0.1', headers: { authorization: 'Bearer viewer' } } } as never);
    expect(await viewer.ca.keyExportPolicy()).toEqual({ enabled: true, allowed: false });
  });
});
