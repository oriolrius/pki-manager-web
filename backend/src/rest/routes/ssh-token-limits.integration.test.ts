/**
 * TASK-247 — optional sign-user fleet-token limits: allowed principals (from
 * the token zone catalog) and a maximum certificate lifetime.
 *
 * Mint validation and the 403 refusals need no KMS (a CA row is seeded and the
 * request is refused before any signing). The signing path that applies
 * min(default, max) runs against the live KMS and is skipped without it.
 */
import type { SshCaDto } from '../../services/ssh-ca.service.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { sshRoutes } from './ssh.routes.js';
import { db } from '../../db/client.js';
import { auditLog, sshCas, sshCertificates, sshFleetTokens, sshIdentities, sshPrincipals, zones } from '../../db/schema.js';
import {
  getSshFleetTokenService,
  applySignUserLimits,
  SshTokenLimitError,
} from '../../services/ssh-fleet-token.service.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getKMSService } from '../../kms/service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };
const tokens = getSshFleetTokenService();
const WEEK = 7 * 24 * 3600;

describe('TASK-247 — applySignUserLimits', () => {
  const t = { name: 'ci', allowedPrincipals: ['deploy'], maxValidForSeconds: 900 };

  it('passes allowed principals (and their host-scoped form) within the max', () => {
    expect(applySignUserLimits(t, { principals: ['deploy'], validForSeconds: 600 }, WEEK)).toBe(600);
    expect(applySignUserLimits(t, { principals: ['deploy@web1.lab'] }, WEEK)).toBe(900);
  });

  it('defaults to min(default, max) when the request has no validForSeconds', () => {
    expect(applySignUserLimits(t, { principals: ['deploy'] }, WEEK)).toBe(900);
    expect(applySignUserLimits({ ...t, maxValidForSeconds: 10 * WEEK }, { principals: ['deploy'] }, WEEK)).toBe(WEEK);
  });

  it('refuses other principals and longer lifetimes', () => {
    expect(() => applySignUserLimits(t, { principals: ['deploy', 'root'] }, WEEK)).toThrow(SshTokenLimitError);
    expect(() => applySignUserLimits(t, { principals: ['deploy'], validForSeconds: 901 }, WEEK)).toThrow(/at most 900 s/);
  });

  it('an unrestricted token keeps the old behaviour', () => {
    const open = { name: 'old', allowedPrincipals: null, maxValidForSeconds: null };
    expect(applySignUserLimits(open, { principals: ['root'] }, WEEK)).toBe(WEEK);
    expect(applySignUserLimits(open, { principals: ['root'], validForSeconds: 99 * WEEK }, WEEK)).toBe(99 * WEEK);
  });
});

describe('TASK-247 — mint with limits and refusals (no KMS)', () => {
  let ext: FastifyInstance;
  let api: FastifyInstance;
  const caId = randomUUID();
  const otherZone = randomUUID();
  let limited: Awaited<ReturnType<typeof tokens.mint>>;

  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    await db.insert(zones).values({ id: otherZone, name: `tl-${otherZone.slice(0, 6)}`, displayName: 'Other' });
    await db.insert(sshCas).values({
      id: caId,
      caType: 'user',
      kmsKeyId: 'k',
      kmsPublicKeyId: 'kp',
      opensshPublicKey: 'ecdsa-sha2-nistp256 AAAA',
      fingerprintSha256: `SHA256:${caId}`,
      status: 'retired',
    });
    await getSshPrincipalService().createPrincipal(ctx, { name: 'tl-deploy', zone: 'default' });
    await getSshPrincipalService().createPrincipal(ctx, { name: 'tl-foreign', zone: otherZone });
    limited = await tokens.mint(ctx, {
      name: 'ci-limited',
      userCaId: caId,
      opSet: ['sign-user'],
      allowedPrincipals: ['tl-deploy'],
      maxValidForSeconds: 900,
    });
    ext = Fastify();
    registerSshExternalRoutes(ext);
    await ext.ready();
    api = Fastify();
    await api.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await api.ready();
  });

  afterAll(async () => {
    await ext?.close();
    await api?.close();
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    await db.delete(sshFleetTokens).where(eq(sshFleetTokens.userCaId, caId));
    await db.delete(sshCas).where(eq(sshCas.id, caId));
    await db.delete(sshPrincipals).where(inArray(sshPrincipals.name, ['tl-deploy', 'tl-foreign']));
    await db.delete(zones).where(eq(zones.id, otherZone));
    await db.delete(sshIdentities).where(eq(sshIdentities.subject, 'tl-ci@pipeline'));
  });

  it('stores and lists the limits; tokens minted without limits list as null', async () => {
    expect(limited.record).toMatchObject({ allowedPrincipals: ['tl-deploy'], maxValidForSeconds: 900 });
    const open = await tokens.mint(ctx, { name: 'ci-open', userCaId: caId, opSet: ['sign-user'] });
    expect(open.record).toMatchObject({ allowedPrincipals: null, maxValidForSeconds: null });
  });

  it('REST mint accepts the limits', async () => {
    const res = await api.inject({
      method: 'POST',
      url: '/api/v1/ssh/tokens',
      payload: { name: 'ci-rest', userCaId: caId, opSet: ['sign-user'], allowedPrincipals: ['tl-deploy'], maxValidForSeconds: 600 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toMatchObject({ allowedPrincipals: ['tl-deploy'], maxValidForSeconds: 600 });
  });

  it('refuses principals outside the token zone catalog, and limits without sign-user', async () => {
    await expect(
      tokens.mint(ctx, { name: 'x', userCaId: caId, opSet: ['sign-user'], allowedPrincipals: ['tl-foreign'] })
    ).rejects.toThrow(/not in the catalog of zone 'default'/);
    await expect(
      tokens.mint(ctx, { name: 'x', opSet: ['get-principals'], maxValidForSeconds: 900, zone: 'default' })
    ).rejects.toThrow(/apply only to a token with sign-user/);
  });

  const signUser = (payload: { principals: string[]; validForSeconds?: number }) =>
    ext.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/sign-user',
      headers: { authorization: `Bearer ${limited.token}` },
      payload: { subject: 'tl-ci@pipeline', sshPublicKey: 'ssh-ed25519 AAAA', ...payload },
    });

  it('sign-user with a principal outside the list is a 403 TOKEN_LIMIT, audited, no identity created', async () => {
    const res = await signUser({ principals: ['root'] });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TOKEN_LIMIT');
    expect(res.json().error.message).toMatch(/may not sign principal\(s\) root — allowed: tl-deploy/);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.operation, 'ssh.external.sign'), eq(auditLog.entityId, limited.record.id)));
    expect(rows.map((r) => r.status)).toEqual(['failure']);
    expect(await db.select().from(sshIdentities).where(eq(sshIdentities.subject, 'tl-ci@pipeline'))).toHaveLength(0);
  });

  it('sign-user above the max lifetime is a 403 TOKEN_LIMIT', async () => {
    const res = await signUser({ principals: ['tl-deploy'], validForSeconds: 3600 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/at most 900 s; requested 3600 s/);
  });
});

describe.skipIf(!KMS)('TASK-247 — limited token signs with min(default, max) (KMS)', () => {
  let ext: FastifyInstance;
  let userCa: Pick<SshCaDto, 'id'>;
  let createdCa: boolean;
  let work: string;
  let userPub: string;
  let minted: Awaited<ReturnType<typeof tokens.mint>>;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-tl-'));
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    userPub = readFileSync(join(work, 'u.pub'), 'utf8');
    const existing = (await db.select().from(sshCas).where(and(eq(sshCas.caType, 'user'), eq(sshCas.status, 'active'), eq(sshCas.zoneId, 'default'))))[0];
    userCa = existing ?? (await getSshCaService().create(ctx, { caType: 'user' }));
    createdCa = !existing;
    await getSshPrincipalService().createPrincipal(ctx, { name: 'tl-kms-deploy' });
    minted = await tokens.mint(ctx, { name: 'ci-kms', userCaId: userCa.id, opSet: ['sign-user'], allowedPrincipals: ['tl-kms-deploy'], maxValidForSeconds: 900 });
    ext = Fastify();
    registerSshExternalRoutes(ext);
    await ext.ready();
  }, 60_000);

  afterAll(async () => {
    await ext?.close();
    const idents = await db.select().from(sshIdentities).where(eq(sshIdentities.subject, 'tl-kms@pipeline'));
    if (idents.length) {
      await db.delete(sshCertificates).where(inArray(sshCertificates.identityId, idents.map((i) => i.id)));
      await db.delete(sshIdentities).where(eq(sshIdentities.subject, 'tl-kms@pipeline'));
    }
    await db.delete(sshFleetTokens).where(eq(sshFleetTokens.id, minted.record.id));
    await db.delete(sshPrincipals).where(eq(sshPrincipals.name, 'tl-kms-deploy'));
    if (createdCa) {
      const [row] = await db.select().from(sshCas).where(eq(sshCas.id, userCa.id));
      try { await getKMSService().destroyKeyPair(row.kmsKeyId, row.kmsPublicKeyId); } catch { /* */ }
      await db.delete(sshCas).where(eq(sshCas.id, userCa.id));
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('a request without validForSeconds gets the token max (15 min), not one week', async () => {
    const before = Date.now();
    const res = await ext.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/sign-user',
      headers: { authorization: `Bearer ${minted.token}` },
      payload: { subject: 'tl-kms@pipeline', sshPublicKey: userPub, principals: ['tl-kms-deploy'] },
    });
    expect(res.statusCode).toBe(200);
    const ttl = (new Date(res.json().validBefore).getTime() - before) / 1000;
    expect(ttl).toBeGreaterThan(800);
    expect(ttl).toBeLessThanOrEqual(905);
  });
});
