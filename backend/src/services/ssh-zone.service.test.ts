/**
 * ZONE-02 (decision-017) zone service + resolveZone, without the KMS. Uses the
 * shared migrated test DB (seeded 'default'); every test resets to a single
 * zone afterwards so other suites keep seeing an unambiguous 'default'.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ne, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { zones, auditLog } from '../db/schema.js';
import {
  getSshZoneService,
  resolveZone,
  SshZoneAmbiguousError,
  SshZoneNotFoundError,
  SshZoneArchivedError,
  SshZoneExistsError,
  SshZoneSlugError,
} from './ssh-zone.service.js';
import { getSshCaService } from './ssh-ca.service.js';

const ctx = { db, ipAddress: null };
const resetZones = () => db.delete(zones).where(ne(zones.name, 'default'));

describe('SshZoneService + resolveZone (ZONE-02)', () => {
  beforeEach(async () => {
    await resetZones();
  });
  afterAll(async () => {
    await resetZones();
  });

  it('AC#1 — create, list, rename displayName, archive and un-archive', async () => {
    const z = await getSshZoneService().create(ctx, { name: 'prod', displayName: 'Production' });
    expect(z).toMatchObject({ name: 'prod', displayName: 'Production', status: 'active' });

    const listed = await getSshZoneService().list(ctx);
    expect(listed.map((x) => x.name).sort()).toEqual(['default', 'prod']);

    const renamed = await getSshZoneService().update(ctx, 'prod', { displayName: 'Prod EU' });
    expect(renamed.displayName).toBe('Prod EU');
    expect(renamed.name).toBe('prod'); // slug is immutable

    const archived = await getSshZoneService().archive(ctx, 'prod');
    expect(archived.status).toBe('archived');
    expect((await getSshZoneService().list(ctx)).map((x) => x.name)).not.toContain('prod');
    expect((await getSshZoneService().list(ctx, { includeArchived: true })).map((x) => x.name)).toContain('prod');

    const back = await getSshZoneService().unarchive(ctx, 'prod');
    expect(back.status).toBe('active');
  });

  it('AC#4 — a zone is addressable by slug and by id', async () => {
    const z = await getSshZoneService().create(ctx, { name: 'staging', displayName: 'Staging' });
    expect((await getSshZoneService().get(ctx, 'staging')).id).toBe(z.id);
    expect((await getSshZoneService().get(ctx, z.id)).name).toBe('staging');
    expect((await resolveZone(ctx, 'staging')).id).toBe(z.id);
    expect((await resolveZone(ctx, z.id)).name).toBe('staging');
    await expect(getSshZoneService().get(ctx, 'nope')).rejects.toThrow(SshZoneNotFoundError);
  });

  it('AC#2/#3 — resolveZone is implicit while single, fail-closed once ambiguous', async () => {
    // single zone (default) → implicit
    expect((await resolveZone(ctx)).name).toBe('default');
    await getSshZoneService().create(ctx, { name: 'prod', displayName: 'P' });
    // two zones → ambiguous, and the error names the available zones
    const err = await resolveZone(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(SshZoneAmbiguousError);
    expect(err.message).toContain('default');
    expect(err.message).toContain('prod');
    // archiving one restores an unambiguous single active zone
    await getSshZoneService().archive(ctx, 'prod');
    expect((await resolveZone(ctx)).name).toBe('default');
  });

  it('AC#5 — creating an entity in an archived zone is refused (before the KMS)', async () => {
    await getSshZoneService().create(ctx, { name: 'old', displayName: 'Old' });
    await getSshZoneService().archive(ctx, 'old');
    // ssh-ca create resolves + gates the zone before ever touching the KMS.
    await expect(getSshCaService().create(ctx, { caType: 'user', zone: 'old' })).rejects.toThrow(SshZoneArchivedError);
    // …but the archived zone is still resolvable, so existing trust material serves.
    expect((await resolveZone(ctx, 'old')).status).toBe('archived');
  });

  it('rejects invalid slugs and duplicate names', async () => {
    await expect(getSshZoneService().create(ctx, { name: 'Bad Slug!' })).rejects.toThrow(SshZoneSlugError);
    await getSshZoneService().create(ctx, { name: 'dup', displayName: 'Dup' });
    await expect(getSshZoneService().create(ctx, { name: 'dup' })).rejects.toThrow(SshZoneExistsError);
  });

  it('AC#6 — create/update/archive each write an audit_log row', async () => {
    const before = (await db.select().from(auditLog).where(eq(auditLog.entityType, 'zone'))).length;
    const z = await getSshZoneService().create(ctx, { name: 'audited', displayName: 'A' });
    await getSshZoneService().update(ctx, z.id, { description: 'x' });
    await getSshZoneService().archive(ctx, z.id);
    const rows = (await db.select().from(auditLog).where(eq(auditLog.entityType, 'zone'))) as any[];
    expect(rows.length).toBe(before + 3);
    expect(rows.map((r) => r.operation)).toEqual(
      expect.arrayContaining(['ssh.zone.create', 'ssh.zone.update', 'ssh.zone.archive'])
    );
  });
});
