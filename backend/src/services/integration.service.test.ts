import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { IntegrationService } from './integration.service.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

vi.mock('../lib/oidc.js', async (original) => ({
  ...await original<typeof import('../lib/oidc.js')>(), isOIDCEnabled: () => false,
}));

const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });
let sqlite: Database.Database;
const token = 'pkimg_existing-token-preserved-by-migration';
const hash = createHash('sha256').update(token).digest('hex');
function apply(upTo = migrations.length) {
  sqlite.pragma('foreign_keys = OFF');
  for (const migration of migrations.slice(0, upTo)) {
    for (const statement of migration.sql) sqlite.exec(statement);
  }
}
function seedCA() {
  sqlite.exec(`INSERT INTO certificate_authorities
    (id,kms_certificate_id,kms_key_id,subject_dn,serial_number,not_before,not_after)
    VALUES ('ca','kms-cert','kms-key','CN=Test','01',0,4102444800)`);
}

beforeEach(() => { sqlite = new Database(':memory:'); });
afterEach(() => { sqlite.close(); });

describe('integration migration', () => {
  it('preserves existing tokens, revocation and ownership, and recognizes unambiguous SCEP history', async () => {
    apply(migrations.length - 1);
    seedCA();
    const insert = sqlite.prepare(`INSERT INTO clusters
      (id,name,ca_id,token_hash,token_prefix,revoked_at) VALUES (?,?, 'ca',?,?,?)`);
    insert.run('kube', 'Old Kubernetes', hash, token.slice(0, 12), null);
    insert.run('scep', 'Existing SCEP', hash, token.slice(0, 12), 1234);
    const cert = sqlite.prepare(`INSERT INTO certificates
      (id,ca_id,kms_certificate_id,subject_dn,serial_number,certificate_type,not_before,not_after,source_type,k8s_cluster_id,request_uid)
      VALUES (?,'ca','kms-leaf','CN=Device',?,'client',0,4102444800,'k8s',?,?)`);
    cert.run('kube-cert', '02', 'kube', 'old-kube-request');
    cert.run('scep-cert', '03', 'scep', 'scep:old-request');
    for (const statement of migrations.at(-1)!.sql) sqlite.exec(statement);
    expect(sqlite.prepare('SELECT id,kind,token_hash,revoked_at FROM integrations ORDER BY id').all()).toEqual([
      { id: 'kube', kind: 'kubernetes', token_hash: hash, revoked_at: null },
      { id: 'scep', kind: 'scep', token_hash: hash, revoked_at: 1234 },
    ]);
    expect(sqlite.prepare('SELECT integration_id,source_type,k8s_cluster_id FROM certificates ORDER BY id').all()).toEqual([
      { integration_id: 'kube', source_type: 'k8s', k8s_cluster_id: 'kube' },
      { integration_id: 'scep', source_type: 'scep', k8s_cluster_id: null },
    ]);
    const service = new IntegrationService();
    const ctx = { db: drizzle(sqlite, { schema }) };
    expect(await service.verifyToken(ctx, token)).toMatchObject({ id: 'kube', kind: 'kubernetes' });
    await service.revoke(ctx, 'kube');
    expect(await service.verifyToken(ctx, token)).toBeNull();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('generic and legacy integration APIs', () => {
  it('creates typed service identities, keeps cluster clients compatible and never returns stored secrets', async () => {
    apply(); seedCA();
    const db = drizzle(sqlite, { schema });
    const caller = appRouter.createCaller({ db, req: { ip: '127.0.0.1', headers: {} }, res: {}, user: undefined } as unknown as Context);
    const scep = await caller.integration.register({ name: 'MDM', caId: 'ca', kind: 'scep' });
    const generic = await caller.integration.register({ name: 'Automation', caId: 'ca' });
    const legacy = await caller.cluster.register({ name: 'Existing controller', caId: 'ca' });
    expect(scep).toMatchObject({ kind: 'scep' });
    expect(generic).toMatchObject({ kind: 'generic' });
    expect(legacy).toMatchObject({ kind: 'kubernetes' });
    const list = await caller.integration.list();
    expect(list).toHaveLength(3);
    for (const item of list) {
      expect(item).not.toHaveProperty('token');
      expect(item).not.toHaveProperty('tokenHash');
      expect(item).toHaveProperty('certificatesCount', 0);
    }
    expect(await caller.cluster.getById({ id: legacy!.id })).toHaveProperty('k8sCertificatesCount', 0);
    const service = new IntegrationService();
    expect(await service.verifyToken({ db }, scep!.token)).toMatchObject({ id: scep!.id, kind: 'scep' });
    await caller.integration.revoke({ id: scep!.id });
    expect(await service.verifyToken({ db }, scep!.token)).toBeNull();
    expect(await service.verifyToken({ db }, legacy!.token)).toMatchObject({ id: legacy!.id });
    await expect(caller.integration.register({ name: 'Bad CA', caId: 'missing', kind: 'generic' })).rejects.toThrow();
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.status, 'failure'))).toHaveLength(1);
  });
});
