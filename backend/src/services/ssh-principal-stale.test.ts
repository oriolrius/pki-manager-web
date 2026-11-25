/**
 * TASK-246 — "Stale" means "the rendered principal files changed and were not
 * pushed". Before this, stale = host.updatedAt > lastPrincipalPushAt, and host
 * cert issue/renew writes updatedAt, so every renewal flagged the host Stale.
 *
 * No KMS: host/principal rows are inserted directly; the renewal is simulated
 * by the exact write host issue/renew performs (updatedAt = now).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sshHosts, sshPrincipals, sshHostPrincipalMaps } from '../db/schema.js';
import {
  getSshPrincipalService,
  principalFilesSha256,
  SshPrincipalHashMismatchError,
} from './ssh-principal.service.js';

const ctx = { db, ipAddress: null };
const svc = getSshPrincipalService();
const FQDN_A = 'stale-a.lab.local';
const FQDN_B = 'stale-b.lab.local';

async function wipe() {
  await db.delete(sshHostPrincipalMaps);
  await db.delete(sshPrincipals);
  for (const f of [FQDN_A, FQDN_B]) await db.delete(sshHosts).where(eq(sshHosts.fqdn, f));
}

async function host(fqdn: string): Promise<string> {
  const id = randomUUID();
  await db.insert(sshHosts).values({ id, fqdn, status: 'active' });
  return id;
}

async function principal(name: string): Promise<string> {
  return (await svc.createPrincipal(ctx, { name })).id;
}

describe('TASK-246 — stale tracks principal-file changes only', () => {
  beforeEach(wipe);
  afterAll(wipe);

  it('a new host with no mappings is not Stale', async () => {
    const h = await host(FQDN_A);
    expect((await svc.render(ctx, h)).stale).toBe(false);
  });

  it('a host certificate renewal (updatedAt bump) does NOT make a pushed host Stale', async () => {
    const h = await host(FQDN_A);
    await svc.mapToHost(ctx, { hostId: h, principalId: await principal('ops'), localAccount: 'root' });
    await svc.markPushed(ctx, h);
    expect((await svc.render(ctx, h)).stale).toBe(false);

    // Exactly what SshHostService.issue() writes on issue/renew — a later updatedAt.
    await db.update(sshHosts).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(sshHosts.id, h));

    expect((await svc.render(ctx, h)).stale).toBe(false);
    expect((await svc.staleHosts(ctx)).map((x) => x.id)).not.toContain(h);
  });

  it('mapping a principal makes that host (and only that host) Stale until pushed', async () => {
    const a = await host(FQDN_A);
    const b = await host(FQDN_B);
    await svc.markPushed(ctx, a);
    await svc.markPushed(ctx, b);

    await svc.mapToHost(ctx, { hostId: a, principalId: await principal('web'), localAccount: 'deploy' });

    expect((await svc.render(ctx, a)).stale).toBe(true);
    expect((await svc.render(ctx, b)).stale).toBe(false);
    const stale = (await svc.staleHosts(ctx)).map((x) => x.id);
    expect(stale).toContain(a);
    expect(stale).not.toContain(b);

    await svc.markPushed(ctx, a);
    expect((await svc.render(ctx, a)).stale).toBe(false);
  });

  it('a change right after a push (same millisecond) still reads as Stale', async () => {
    const h = await host(FQDN_A);
    const p = await principal('db');
    // Push stamped in the future: a naive "now" change stamp would sort BEFORE it.
    await db.update(sshHosts).set({ lastPrincipalPushAt: new Date(Date.now() + 5_000) }).where(eq(sshHosts.id, h));
    await svc.mapToHost(ctx, { hostId: h, principalId: p, localAccount: 'postgres' });
    expect((await svc.render(ctx, h)).stale).toBe(true);
  });
});

describe('TASK-246 — canonical sha256 and acknowledgePush', () => {
  beforeEach(wipe);
  afterAll(wipe);

  it('render() exposes the canonical sha256 of its files', async () => {
    const h = await host(FQDN_A);
    expect((await svc.render(ctx, h)).sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // SHA-256 of ""
    );
    await svc.mapToHost(ctx, { hostId: h, principalId: await principal('ops'), localAccount: 'root' });
    const r = await svc.render(ctx, h);
    expect(r.sha256).toBe(principalFilesSha256(r.files));
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the canonical form is account NUL contents NUL, accounts in ascending order', () => {
    const files = { root: 'ops\nops@h\n', deploy: 'web\nweb@h\n' };
    const expected = createHash('sha256').update('deploy\0web\nweb@h\n\0root\0ops\nops@h\n\0').digest('hex');
    expect(principalFilesSha256(files)).toBe(expected);
    // Different splits of the same bytes must not collide.
    expect(principalFilesSha256({ a: 'x\nb\ny\n' })).not.toBe(principalFilesSha256({ a: 'x\n', b: 'y\n' }));
  });

  it('a matching sha256 clears Stale; a different one is refused with the current hash', async () => {
    const h = await host(FQDN_A);
    await svc.mapToHost(ctx, { hostId: h, principalId: await principal('ops'), localAccount: 'root' });
    const r = await svc.render(ctx, h);
    expect(r.stale).toBe(true);

    const wrong = '0'.repeat(64);
    const e = await svc.acknowledgePush(ctx, h, wrong).catch((x) => x);
    expect(e).toBeInstanceOf(SshPrincipalHashMismatchError);
    expect(e.currentSha256).toBe(r.sha256);
    expect((await svc.render(ctx, h)).stale).toBe(true);

    const ok = await svc.acknowledgePush(ctx, h, `sha256:${r.sha256.toUpperCase()}`);
    expect(ok.sha256).toBe(r.sha256);
    expect((await svc.render(ctx, h)).stale).toBe(false);
  });
});
