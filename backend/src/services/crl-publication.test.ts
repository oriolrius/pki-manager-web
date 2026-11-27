/**
 * TASK-288: CRL publication under concurrency, outages, restarts and old (v3) data.
 *
 * The real CRL, certificate and CA services run against the test SQLite database. The key store
 * is in memory (`ControlledKeyStore`, the Transit contract) so that a test can slow, hold or fail
 * the signing. Every CRL is parsed and its signature checked with the CA certificate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { auditLog, certificateAuthorities, certificates, crlDeletedRevocations, crlEntryRemovals, crlPublication, crls } from '../db/schema.js';
import { controlledKeyStore as store } from '../test/controlled-keystore.js';
import { getKMSService } from '../kms/service.js';
import { parseCRL, verifyCRL, generateCRLWithSigner, normalizeSerialHex } from '../crypto/crl.js';
import { CRLReason } from '../crypto/types.js';
import { CRLService, CRLPublicationBusyError, crlEntriesSha256, getCRLService, CRL_LEASE_SECONDS, CRL_PENDING_MAX_AGE_SECONDS } from './crl.service.js';
import { startCrlReconciler } from './crl-reconciler.js';
import { getCAService } from './ca.service.js';
import { deleteCertificateRow, getCertificateService } from './certificate.service.js';
import { publicCrlRoutes } from '../rest/routes/public-crl.routes.js';
import { OpenBaoTransitError } from '../openbao/x509-transit.js';
import { keyStoreErrorResponse } from '../keystore/errors.js';

/** What the Transit client throws when OpenBao is sealed (HTTP 503). */
const sealedError = () => new OpenBaoTransitError(503, 'sign/<name>', 'Vault is sealed');

vi.mock('../kms/service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../kms/service.js')>();
  const { X509KeyStoreService } = await import('../keystore/x509-store.js');
  const { controlledKeyStore } = await import('../test/controlled-keystore.js');
  const service = new original.KMSService({ store: new X509KeyStoreService(controlledKeyStore), enableAuditLog: false });
  return { ...original, getKMSService: () => service };
});

const ctx = { db, ipAddress: '127.0.0.1' };
const createdCas: string[] = [];

const norm = (s: string) => normalizeSerialHex(s);

async function makeCa(name: string): Promise<{ id: string; pem: string; keyId: string }> {
  const ca = await getCAService().create(ctx, {
    subject: { commonName: `${name} ${randomUUID().slice(0, 6)}`, organization: 'CRL Test', country: 'ES' },
    keyAlgorithm: 'RSA-2048',
    validityYears: 5,
  });
  createdCas.push(ca.id);
  const row = db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, ca.id)).get()!;
  return { id: ca.id, pem: await getKMSService().getCertificate(row.kmsCertificateId, ca.id), keyId: row.kmsKeyId };
}

/** Active leaf rows of a CA (the CRL needs only serial, status and revocation fields). */
function makeLeaves(caId: string, count: number): { id: string; serial: string }[] {
  const rows = Array.from({ length: count }, () => ({ id: randomUUID(), serial: randomBytes(16).toString('hex') }));
  for (const r of rows) {
    db.insert(certificates)
      .values({
        id: r.id,
        caId,
        subjectDn: `CN=leaf-${r.serial.slice(0, 8)},O=CRL Test,C=ES`,
        serialNumber: r.serial,
        certificateType: 'server',
        notBefore: new Date(Date.now() - 86_400_000),
        notAfter: new Date(Date.now() + 30 * 86_400_000),
        kmsCertificateId: `leaf-${r.id}`,
        kmsKeyId: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }
  return rows;
}

function crlRows(caId: string) {
  return db.select().from(crls).where(eq(crls.caId, caId)).orderBy(asc(crls.crlNumber), asc(crls.createdAt)).all();
}

const serialsOf = (pem: string) => new Set(parseCRL(pem).revokedCertificates.map((e) => e.serialNumber));

/**
 * Unique numbers; each CRL lists every entry of the one before it (except serials removed on
 * purpose); each signature verifies.
 */
function expectOrderedHistory(caId: string, caPem: string, removedOnPurpose: Set<string> = new Set()) {
  const rows = crlRows(caId).filter((r) => r.entriesSha256 !== null);
  const numbers = rows.map((r) => r.crlNumber);
  expect(new Set(numbers).size).toBe(numbers.length);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].crlNumber).toBeGreaterThan(rows[i - 1].crlNumber);
    const before = serialsOf(rows[i - 1].crlPem);
    const after = serialsOf(rows[i].crlPem);
    for (const s of before) if (!removedOnPurpose.has(s)) expect(after.has(s)).toBe(true);
  }
  for (const r of rows) {
    expect(verifyCRL(r.crlPem, caPem)).toBe(true);
    expect(parseCRL(r.crlPem).crlNumber).toBe(r.crlNumber);
    const parsed = parseCRL(r.crlPem).revokedCertificates.map((e) => ({
      serial: e.serialNumber,
      date: e.revocationDate,
      reason: e.reason ?? CRLReason.UNSPECIFIED,
    }));
    expect(r.entriesSha256).toBe(crlEntriesSha256(parsed));
    expect(r.revokedCount).toBe(parsed.length);
  }
  return rows;
}

function stateOf(caId: string) {
  return db.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get()!;
}

beforeEach(() => store.reset());

afterAll(async () => {
  for (const id of createdCas) {
    db.delete(certificates).where(eq(certificates.caId, id)).run();
    db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, id)).run();
  }
});

describe('CRL publication: concurrency', () => {
  it('20 concurrent revocations: unique ordered numbers, every CRL keeps the earlier entries', async () => {
    const ca = await makeCa('Concurrent CA');
    const leaves = makeLeaves(ca.id, 20);
    store.delayMs = 15;

    await Promise.all(leaves.map((l) => getCertificateService().revoke(ctx, { id: l.id, reason: 'keyCompromise' })));

    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(rows[0].crlNumber).toBe(1);
    expect(rows.map((r) => r.crlNumber)).toEqual(rows.map((_, i) => i + 1)); // no gap in one process
    const newest = rows[rows.length - 1];
    expect(serialsOf(newest.crlPem)).toEqual(new Set(leaves.map((l) => norm(l.serial))));
    // Publications coalesce: far fewer CRLs than revocations.
    expect(rows.length).toBeLessThan(20);
    expect(stateOf(ca.id)).toMatchObject({ lastNumber: newest.crlNumber, lease: null, failureCount: 0 });
  });

  it('two processes on two SQLite connections with revocations and manual generation', async () => {
    const ca = await makeCa('Two Process CA');
    const leaves = makeLeaves(ca.id, 12);
    const path = process.env.DATABASE_PATH!;
    const sqlite2 = new Database(path);
    sqlite2.pragma('journal_mode = WAL');
    sqlite2.pragma('foreign_keys = ON');
    const ctx2 = { db: drizzle(sqlite2, { schema }) as unknown as typeof db, ipAddress: '10.0.0.2' };
    const other = new CRLService();
    store.delayMs = 10;
    try {
      const work: Promise<unknown>[] = [];
      leaves.forEach((leaf, i) => {
        if (i % 2 === 0) {
          work.push(getCertificateService().revoke(ctx, { id: leaf.id, reason: 'superseded' }));
        } else {
          // The other process: its own revocation write, then its own publication.
          sqlite2.prepare(`UPDATE certificates SET status = 'revoked', revocation_date = unixepoch(), revocation_reason = 'keyCompromise' WHERE id = ?`).run(leaf.id);
          work.push(other.regenerateForCa(ctx2, ca.id));
        }
        if (i % 4 === 0) work.push(other.generate(ctx2, { caId: ca.id }), getCRLService().generate(ctx, { caId: ca.id }));
      });
      await Promise.all(work);
      // Each process makes its CRL current again: the newest CRL lists all 12.
      expect(await other.regenerateForCa(ctx2, ca.id)).toBe(true);
      expect(await getCRLService().regenerateForCa(ctx, ca.id)).toBe(true);
    } finally {
      sqlite2.close();
    }
    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(serialsOf(rows[rows.length - 1].crlPem)).toEqual(new Set(leaves.map((l) => norm(l.serial))));
  });

  it('a publisher that lost its lease while it signed drops its CRL; the number is published once', async () => {
    const ca = await makeCa('Lease Loss CA');
    const slow = new CRLService();
    const fast = new CRLService();
    const release = store.holdNextSign();
    const calls = store.signCalls;
    const slowCall = slow.generate(ctx, { caId: ca.id });
    // The slow publisher holds the lease and waits inside its OpenBao signing request.
    await vi.waitFor(() => expect(store.signCalls).toBe(calls + 1));
    const held = stateOf(ca.id);
    expect(held.lease).not.toBeNull();
    // The lease of the slow publisher expires (it hangs on OpenBao); another one takes over.
    db.update(crlPublication).set({ leaseUntil: new Date(Date.now() - 2_000) }).where(eq(crlPublication.caId, ca.id)).run();
    const fastResult = await fast.generate(ctx, { caId: ca.id });
    expect(fastResult.crlNumber).toBe(held.lastNumber + 1);
    release();
    const slowResult = await slowCall;
    expect(slowResult.crlNumber).toBe(fastResult.crlNumber + 1);
    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(rows.filter((r) => r.crlNumber === fastResult.crlNumber).map((r) => r.id)).toEqual([fastResult.id]);
  });

  it('a lease left by a stopped process expires; the next revocation publishes', async () => {
    const ca = await makeCa('Stale Lease CA');
    const [leaf] = makeLeaves(ca.id, 1);
    db.update(crlPublication)
      .set({ lease: 'stopped-process', leaseUntil: new Date(Date.now() + 1_000) })
      .where(eq(crlPublication.caId, ca.id))
      .run();
    const started = Date.now();
    await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    expect(Date.now() - started).toBeLessThan(10_000);
    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(serialsOf(rows[rows.length - 1].crlPem).has(norm(leaf.serial))).toBe(true);
    expect(stateOf(ca.id).lease).toBeNull();
  });

  it('the database refuses a second CRL row with the number of a published one', async () => {
    const ca = await makeCa('Unique Index CA');
    const [first] = crlRows(ca.id);
    expect(() =>
      db.insert(crls).values({ ...first, id: randomUUID(), entriesSha256: 'x'.repeat(64) }).run(),
    ).toThrow(/UNIQUE/);
  });
});

describe('CRL publication: key store outage and recovery', () => {
  const server = Fastify({ logger: false });
  beforeAll(async () => {
    await server.register(publicCrlRoutes);
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
  });

  it('a revocation while OpenBao is sealed stays pending; the CRL download publishes it after recovery', async () => {
    const ca = await makeCa('Outage CA');
    const [leaf] = makeLeaves(ca.id, 1);
    const before = crlRows(ca.id);
    store.failure = sealedError();

    const revoked = await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    expect(revoked.status).toBe('revoked');
    expect(crlRows(ca.id)).toHaveLength(before.length);
    const failed = stateOf(ca.id);
    expect(failed.failureCount).toBe(1);
    expect(failed.lastError).toBe('The key store is unavailable; retry later (sealed)');
    expect(failed.retryAfter!.getTime()).toBeGreaterThan(Date.now());
    const failures = db.select().from(auditLog)
      .where(and(eq(auditLog.operation, 'crl.generate'), eq(auditLog.status, 'failure'))).all()
      .filter((a) => JSON.parse(a.details ?? '{}').caId === ca.id);
    expect(failures).toHaveLength(1);

    // A manual generation fails with the key store error in its cause chain (503 at the API edges).
    const manual = await getCRLService().generate(ctx, { caId: ca.id }).catch((error: unknown) => error);
    expect(keyStoreErrorResponse(manual)).toMatchObject({ status: 503, code: 'KEY_STORE_UNAVAILABLE' });
    expect(crlRows(ca.id)).toHaveLength(before.length);

    // Still sealed: the download serves the CRL it has, with a short cache time, no new attempt.
    const stale = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(stale.statusCode).toBe(200);
    expect(serialsOf(stale.body).has(norm(leaf.serial))).toBe(false);
    const maxAge = Number(/max-age=(\d+)/.exec(String(stale.headers['cache-control']))![1]);
    expect(maxAge).toBeLessThanOrEqual(CRL_PENDING_MAX_AGE_SECONDS);

    // Unsealed, the retry time is over: the next download publishes and serves the revocation.
    store.failure = null;
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
    const fresh = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(fresh.statusCode).toBe(200);
    expect(serialsOf(fresh.body).has(norm(leaf.serial))).toBe(true);
    expect(verifyCRL(fresh.body, ca.pem)).toBe(true);
    expect(Number(/max-age=(\d+)/.exec(String(fresh.headers['cache-control']))![1])).toBeGreaterThan(CRL_PENDING_MAX_AGE_SECONDS);
    expect(stateOf(ca.id)).toMatchObject({ failureCount: 0, retryAfter: null });
    expectOrderedHistory(ca.id, ca.pem);

    // Current now: another download does not publish again.
    const count = crlRows(ca.id).length;
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.der` });
    expect(crlRows(ca.id)).toHaveLength(count);
  });

  it('downloads during the outage do not retry before the retry time and audit only the first failure', async () => {
    const ca = await makeCa('Backoff CA');
    const [leaf] = makeLeaves(ca.id, 1);
    store.failure = new Error('connect ECONNREFUSED');
    await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    const calls = store.signCalls;
    for (let i = 0; i < 5; i++) await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(store.signCalls).toBe(calls);
    // After the retry time, a passive retry fails again: the series is audited once.
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(store.signCalls).toBe(calls + 1);
    const state = stateOf(ca.id);
    expect(state.failureCount).toBe(2);
    expect(state.retryAfter!.getTime() - Date.now()).toBeGreaterThan(5_000); // doubled
    const failures = db.select().from(auditLog)
      .where(and(eq(auditLog.operation, 'crl.generate'), eq(auditLog.status, 'failure'))).all()
      .filter((a) => JSON.parse(a.details ?? '{}').caId === ca.id);
    expect(failures.map((a) => JSON.parse(a.details!).trigger)).toEqual(['change']);
  });

  it('revocations queued behind a failed signing do not repeat it; each revocation is kept', async () => {
    const ca = await makeCa('Queued Outage CA');
    const leaves = makeLeaves(ca.id, 5);
    store.failure = sealedError();
    store.delayMs = 300; // OpenBao answers slowly while it is down
    const calls = store.signCalls;
    const started = Date.now();
    const results = await Promise.all(leaves.map((l) => getCertificateService().revoke(ctx, { id: l.id, reason: 'keyCompromise' })));
    expect(results.every((r) => r.status === 'revoked')).toBe(true);
    expect(store.signCalls - calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(stateOf(ca.id).failureCount).toBe(1);
    // After recovery, one download publishes all five.
    store.reset();
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
    const res = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(serialsOf(res.body)).toEqual(new Set(leaves.map((l) => norm(l.serial))));
  });

  it('a background pass stops at the first CA when the key store is unavailable', async () => {
    const first = await makeCa('Pass Stop CA 1');
    const second = await makeCa('Pass Stop CA 2');
    for (const ca of [first, second]) {
      db.update(crls).set({ nextUpdate: new Date(Date.now() - 1_000) }).where(eq(crls.caId, ca.id)).run(); // expired
    }
    store.failure = sealedError();
    const calls = store.signCalls;
    const pass = await new CRLService().reconcile(ctx);
    expect(pass.stopped).toBe(true);
    expect(store.signCalls - calls).toBe(1);
  });

  it('after a restart, the background job publishes the pending CRL without any request', async () => {
    const ca = await makeCa('Restart CA');
    const [leaf] = makeLeaves(ca.id, 1);
    store.failure = sealedError();
    await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    store.failure = null;
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();

    // A new process: no queue, no memory of the failure; only the database.
    const restarted = new CRLService();
    const pass = await restarted.reconcile(ctx);
    expect(pass.published).toBeGreaterThanOrEqual(1);
    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(serialsOf(rows[rows.length - 1].crlPem).has(norm(leaf.serial))).toBe(true);
    // A second pass finds it current.
    const count = crlRows(ca.id).length;
    await restarted.reconcile(ctx);
    expect(crlRows(ca.id)).toHaveLength(count);
  });

  it('the job timer publishes on its own and stops on request', async () => {
    const ca = await makeCa('Timer CA');
    const [leaf] = makeLeaves(ca.id, 1);
    store.failure = sealedError();
    await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    store.failure = null;
    db.update(crlPublication).set({ retryAfter: null }).where(eq(crlPublication.caId, ca.id)).run();
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const job = startCrlReconciler({ ctx, log, initialDelayMs: 10, intervalMs: 50 });
    try {
      await vi.waitFor(() => {
        const rows = crlRows(ca.id);
        expect(serialsOf(rows[rows.length - 1].crlPem).has(norm(leaf.serial))).toBe(true);
      }, { timeout: 10_000, interval: 50 });
    } finally {
      job.stop();
    }
    expect(log.info).toHaveBeenCalled();
  });

  it('a listening server starts the job (onListen) and closing it stops the job', async () => {
    const ca = await makeCa('Listen CA');
    const [leaf] = makeLeaves(ca.id, 1);
    store.failure = sealedError();
    await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    store.failure = null;
    db.update(crlPublication).set({ retryAfter: null }).where(eq(crlPublication.caId, ca.id)).run();
    const app = Fastify({ logger: false });
    await app.register(publicCrlRoutes, { reconciler: { initialDelayMs: 10, intervalMs: 60_000 } });
    const ready = Fastify({ logger: false });
    await ready.register(publicCrlRoutes, { reconciler: { initialDelayMs: 10, intervalMs: 60_000 } });
    await ready.ready(); // ready() alone does not start the job
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(serialsOf(crlRows(ca.id).at(-1)!.crlPem).has(norm(leaf.serial))).toBe(false);
    await ready.close();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      await vi.waitFor(() => {
        const rows = crlRows(ca.id);
        expect(serialsOf(rows[rows.length - 1].crlPem).has(norm(leaf.serial))).toBe(true);
      }, { timeout: 10_000, interval: 50 });
    } finally {
      await app.close();
    }
  });
});

describe('CRL publication: entries are kept', () => {
  it('a deleted revoked certificate stays in later CRLs; removeFromCrl takes its serial out', async () => {
    const ca = await makeCa('Carry CA');
    const [kept, removed] = makeLeaves(ca.id, 2);
    for (const l of [kept, removed]) await getCertificateService().revoke(ctx, { id: l.id, reason: 'keyCompromise' });

    await getCertificateService().delete(ctx, { id: kept.id });
    expect(await getCRLService().regenerateForCa(ctx, ca.id)).toBe(true); // still current
    const forced = await getCRLService().generate(ctx, { caId: ca.id });
    const forcedPem = crlRows(ca.id).find((r) => r.id === forced.id)!.crlPem;
    expect(serialsOf(forcedPem)).toEqual(new Set([norm(kept.serial), norm(removed.serial)]));

    await getCertificateService().delete(ctx, { id: removed.id, removeFromCrl: true });
    const onPurpose = new Set([norm(removed.serial)]);
    let rows = expectOrderedHistory(ca.id, ca.pem, onPurpose);
    expect(serialsOf(rows[rows.length - 1].crlPem)).toEqual(new Set([norm(kept.serial)]));
    await getCRLService().generate(ctx, { caId: ca.id });
    rows = expectOrderedHistory(ca.id, ca.pem, onPurpose);
    expect(serialsOf(rows[rows.length - 1].crlPem)).toEqual(new Set([norm(kept.serial)]));
  });
});

describe('CRL publication: CRLs written before migration 0018', () => {
  it('keeps duplicate numbers with different DER, publishes above them and keeps all their entries', async () => {
    const ca = await makeCa('Legacy CA');
    // Remove the CRL that CA creation published: the history below is the v3 one.
    db.delete(crls).where(eq(crls.caId, ca.id)).run();
    db.delete(crlPublication).where(eq(crlPublication.caId, ca.id)).run();
    const [inDb, deleted, other] = makeLeaves(ca.id, 3);
    const revokedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000);
    db.update(certificates)
      .set({ status: 'revoked', revocationDate: revokedAt, revocationReason: 'keyCompromise' })
      .where(inArray(certificates.id, [inDb.id, other.id]))
      .run();
    db.delete(certificates).where(eq(certificates.id, deleted.id)).run();

    const kms = getKMSService();
    const signed = async (n: number, serials: string[]) =>
      (await generateCRLWithSigner({
        issuer: { CN: 'ignored', O: 'CRL Test', C: 'ES' },
        crlNumber: n,
        thisUpdate: new Date(Date.now() - 7_200_000),
        nextUpdate: new Date(Date.now() + 5 * 86_400_000),
        revokedCertificates: serials.map((s) => ({ serialNumber: s, revocationDate: revokedAt, reason: CRLReason.KEY_COMPROMISE })),
        signatureAlgorithm: 'SHA256-RSA',
        issuerCertificate: ca.pem,
        signer: (tbs, hash) => kms.signData(ca.keyId, tbs, hash, ca.id),
      })).pem;
    // v3 race: two different CRLs both numbered 13 (both were served), and an older 12.
    const legacy = [
      { id: randomUUID(), crlNumber: 12, crlPem: await signed(12, [inDb.serial]), createdAt: new Date(Date.now() - 7_300_000) },
      { id: randomUUID(), crlNumber: 13, crlPem: await signed(13, [inDb.serial, deleted.serial]), createdAt: new Date(Date.now() - 7_200_000) },
      { id: randomUUID(), crlNumber: 13, crlPem: await signed(13, [inDb.serial, other.serial]), createdAt: new Date(Date.now() - 7_100_000) },
    ];
    for (const r of legacy) {
      db.insert(crls).values({
        ...r, caId: ca.id, thisUpdate: new Date(Date.now() - 7_200_000), nextUpdate: new Date(Date.now() + 5 * 86_400_000), revokedCount: 2,
      }).run();
    }
    const snapshot = () => JSON.stringify(db.select().from(crls).where(inArray(crls.id, legacy.map((r) => r.id))).orderBy(asc(crls.id)).all());
    const before = snapshot();

    // The newest old CRL (13, second row) lacks the deleted serial of the other 13: publish 14.
    expect(await getCRLService().regenerateForCa(ctx, ca.id)).toBe(true);
    const rows = crlRows(ca.id);
    const published = rows.filter((r) => r.entriesSha256 !== null);
    expect(published.map((r) => r.crlNumber)).toEqual([14]);
    expect(serialsOf(published[0].crlPem)).toEqual(new Set([inDb.serial, deleted.serial, other.serial].map(norm)));
    expect(verifyCRL(published[0].crlPem, ca.pem)).toBe(true);
    expect(snapshot()).toBe(before);
    expect(rows.filter((r) => r.crlNumber === 13)).toHaveLength(2);

    // Current now; a manual generation continues at 15 with the same entries.
    expect(await getCRLService().regenerateForCa(ctx, ca.id)).toBe(true);
    expect(crlRows(ca.id)).toHaveLength(4);
    const next = await getCRLService().generate(ctx, { caId: ca.id });
    expect(next.crlNumber).toBe(15);
    expect(snapshot()).toBe(before);
    const latest = await getCRLService().getLatest(ctx, { caId: ca.id });
    expect(latest!.crlNumber).toBe(15);
    expect(stateOf(ca.id).lastNumber).toBe(15);
  });

  it('serves the newest of two old CRLs with the same number, the same one each time', async () => {
    const ca = await makeCa('Legacy Serve CA');
    db.delete(crls).where(eq(crls.caId, ca.id)).run();
    db.delete(crlPublication).where(eq(crlPublication.caId, ca.id)).run();
    const signedEmpty = async (createdAt: Date) =>
      (await generateCRLWithSigner({
        issuer: { CN: 'ignored', O: 'CRL Test', C: 'ES' },
        crlNumber: 3,
        thisUpdate: createdAt,
        nextUpdate: new Date(Date.now() + 5 * 86_400_000),
        revokedCertificates: [],
        signatureAlgorithm: 'SHA256-RSA',
        issuerCertificate: ca.pem,
        signer: (tbs, hash) => getKMSService().signData(ca.keyId, tbs, hash, ca.id),
      })).pem;
    const older = { id: randomUUID(), createdAt: new Date(Date.now() - 60_000) };
    const newer = { id: randomUUID(), createdAt: new Date(Date.now() - 30_000) };
    for (const r of [older, newer]) {
      db.insert(crls).values({
        id: r.id, caId: ca.id, crlNumber: 3, thisUpdate: r.createdAt, nextUpdate: new Date(Date.now() + 5 * 86_400_000),
        crlPem: await signedEmpty(r.createdAt), revokedCount: 0, createdAt: r.createdAt,
      }).run();
    }
    for (let i = 0; i < 3; i++) {
      const latest = await getCRLService().getLatest(ctx, { caId: ca.id });
      expect(latest!.id).toBe(newer.id);
    }
    // Both list the same (no) entries: the newest is current, nothing is published.
    const result = await getCRLService().refreshForDistribution(ctx, ca.id);
    expect(result).toMatchObject({ status: 'current', crl: { id: newer.id } });
  });
});

describe('CRL publication: a revocation deleted before any CRL lists it', () => {
  const server = Fastify({ logger: false });
  beforeAll(async () => {
    await server.register(publicCrlRoutes, { reconciler: false });
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
  });

  const entryOf = (pem: string, serial: string) => parseCRL(pem).revokedCertificates.find((e) => e.serialNumber === norm(serial));

  it('service delete and bulk delete keep serial, date and reason; the first CRL after unseal and a restart lists them', async () => {
    const ca = await makeCa('Deleted Pending CA');
    const [viaService, viaBulk] = makeLeaves(ca.id, 2);
    store.failure = sealedError();
    await getCertificateService().revoke(ctx, { id: viaService.id, reason: 'keyCompromise' });
    await getCertificateService().revoke(ctx, { id: viaBulk.id, reason: 'superseded' });
    const revokedAt = new Map(
      db.select().from(certificates).where(eq(certificates.caId, ca.id)).all().map((c) => [c.id, c.revocationDate!]),
    );
    const before = crlRows(ca.id).length;

    // Both deleted with removeFromCrl=false while OpenBao is still sealed: no CRL lists them yet.
    await getCertificateService().delete(ctx, { id: viaService.id, removeFromCrl: false });
    deleteCertificateRow(db, viaBulk.id, { removeFromCrl: false }); // the bulk tRPC and REST paths
    expect(db.select().from(certificates).where(eq(certificates.caId, ca.id)).all()).toHaveLength(0);
    expect(crlRows(ca.id)).toHaveLength(before);
    expect(db.select().from(crlDeletedRevocations).where(eq(crlDeletedRevocations.caId, ca.id)).all()).toHaveLength(2);

    // "Restart": a new service instance (no memory of this one), then unseal.
    store.failure = null;
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
    const restarted = new CRLService();
    const pass = await restarted.reconcile(ctx, { full: true });
    expect(pass.published).toBeGreaterThanOrEqual(1);
    const rows = expectOrderedHistory(ca.id, ca.pem);
    expect(rows).toHaveLength(before + 1); // the first signed CRL after unseal
    const first = rows[rows.length - 1].crlPem;
    const a = entryOf(first, viaService.serial)!;
    const b = entryOf(first, viaBulk.serial)!;
    expect(a.reason).toBe(CRLReason.KEY_COMPROMISE);
    expect(b.reason).toBe(CRLReason.SUPERSEDED);
    expect(a.revocationDate.getTime()).toBe(Math.floor(revokedAt.get(viaService.id)!.getTime() / 1000) * 1000);
    expect(b.revocationDate.getTime()).toBe(Math.floor(revokedAt.get(viaBulk.id)!.getTime() / 1000) * 1000);

    // Later CRLs keep them.
    await getCRLService().generate(ctx, { caId: ca.id });
    const latest = expectOrderedHistory(ca.id, ca.pem).at(-1)!.crlPem;
    expect(serialsOf(latest)).toEqual(new Set([norm(viaService.serial), norm(viaBulk.serial)]));
  });

  it('deletes the committed revocation when another SQLite writer is still revoking the certificate', async () => {
    const ca = await makeCa('Concurrent revoke and delete');
    const [leaf] = makeLeaves(ca.id, 1);
    const writer = spawn(process.execPath, ['--eval', `
      const Database = require('better-sqlite3');
      const sqlite = new Database(process.env.DATABASE_PATH);
      sqlite.exec('BEGIN IMMEDIATE');
      sqlite.prepare("UPDATE certificates SET status='revoked', revocation_reason='keyCompromise' WHERE id=?").run(process.argv[1]);
      process.send('revoking');
      setTimeout(() => { sqlite.exec('COMMIT'); sqlite.close(); }, 250);
    `, leaf.id], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    try {
      await once(writer, 'message');
      deleteCertificateRow(db, leaf.id);
      const saved = db.select().from(crlDeletedRevocations).where(eq(crlDeletedRevocations.caId, ca.id)).get();
      expect(saved).toMatchObject({ serialNumber: norm(leaf.serial), revocationReason: 'keyCompromise' });
    } finally {
      writer.kill();
    }
  });

  it('an explicit removeFromCrl during the outage leaves the serial out of the first CRL after unseal', async () => {
    const ca = await makeCa('Removed Pending CA');
    const [kept, removed, removedBulk] = makeLeaves(ca.id, 3);
    store.failure = sealedError();
    for (const l of [kept, removed, removedBulk]) await getCertificateService().revoke(ctx, { id: l.id, reason: 'keyCompromise' });
    await getCertificateService().delete(ctx, { id: removed.id, removeFromCrl: true });
    deleteCertificateRow(db, removedBulk.id, { removeFromCrl: true });
    expect(db.select().from(crlEntryRemovals).where(eq(crlEntryRemovals.caId, ca.id)).all()).toHaveLength(2);
    expect(db.select().from(crlDeletedRevocations).where(eq(crlDeletedRevocations.caId, ca.id)).all()).toHaveLength(0);

    store.failure = null;
    db.update(crlPublication).set({ retryAfter: new Date(Date.now() - 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
    const res = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(serialsOf(res.body)).toEqual(new Set([norm(kept.serial)]));
  });
});

describe('CRL publication: fast path of unchanged downloads', () => {
  const server = Fastify({ logger: false });
  beforeAll(async () => {
    await server.register(publicCrlRoutes, { reconciler: false });
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
  });

  /** Counts the full reads of the CA state (certificates, removals, deleted revocations). */
  function countSnapshots() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return vi.spyOn(CRLService.prototype as any, 'snapshot');
  }

  it('serves the last CRL of an expired CA without scanning its revoked certificates again', async () => {
    const ca = await makeCa('Expired CA');
    db.update(certificateAuthorities).set({ status: 'expired' }).where(eq(certificateAuthorities.id, ca.id)).run();
    const service = getCRLService();
    const spy = countSnapshots();
    try {
      expect((await service.refreshForDistribution(ctx, ca.id)).status).toBe('current');
      expect(spy).not.toHaveBeenCalled();
      db.update(crls).set({ nextUpdate: new Date(Date.now() - 1000) }).where(eq(crls.caId, ca.id)).run();
      expect(await service.refreshForDistribution(ctx, ca.id)).toMatchObject({ status: 'pending', need: 'expired' });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('a download of an unchanged CRL reads no certificate; any write, also from another connection, invalidates it', async () => {
    const ca = await makeCa('Fast Path CA');
    const leaves = makeLeaves(ca.id, 4);
    await getCertificateService().revoke(ctx, { id: leaves[0].id, reason: 'keyCompromise' });
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` }); // verifies
    const state = stateOf(ca.id);
    expect(state.verifiedGeneration).toBe(state.changeGeneration);

    const spy = countSnapshots();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await server.inject({ method: 'GET', url: `/crl/${ca.id}.der` });
        expect(res.statusCode).toBe(200);
        expect(Number(/max-age=(\d+)/.exec(String(res.headers['cache-control']))![1])).toBeGreaterThan(CRL_PENDING_MAX_AGE_SECONDS);
      }
      expect(spy).not.toHaveBeenCalled();
      // A non-revoked change does not invalidate it.
      db.update(certificates).set({ subjectDn: 'CN=renamed,O=CRL Test,C=ES' }).where(eq(certificates.id, leaves[1].id)).run();
      await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
      expect(spy).not.toHaveBeenCalled();

      // A revocation written by another process (second connection, raw SQL, no service call).
      const sqlite2 = new Database(process.env.DATABASE_PATH!);
      try {
        sqlite2.prepare(`UPDATE certificates SET status = 'revoked', revocation_date = unixepoch(), revocation_reason = 'superseded' WHERE id = ?`).run(leaves[2].id);
      } finally {
        sqlite2.close();
      }
      const res = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
      expect(serialsOf(res.body)).toEqual(new Set([norm(leaves[0].serial), norm(leaves[2].serial)]));
      expect(spy).toHaveBeenCalled();
      spy.mockClear();
      await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('a revocation written while the CRL is signed is not covered by that CRL: the next download publishes it', async () => {
    const ca = await makeCa('Fast Race CA');
    const [first, second] = makeLeaves(ca.id, 2);
    db.update(certificates).set({ status: 'revoked', revocationDate: new Date(), revocationReason: 'keyCompromise' }).where(eq(certificates.id, first.id)).run();
    const release = store.holdNextSign();
    const calls = store.signCalls;
    const publishing = getCRLService().refreshForDistribution(ctx, ca.id);
    await vi.waitFor(() => expect(store.signCalls).toBe(calls + 1));
    // Written after the snapshot, before the commit.
    db.update(certificates).set({ status: 'revoked', revocationDate: new Date(), revocationReason: 'keyCompromise' }).where(eq(certificates.id, second.id)).run();
    release();
    const published = await publishing;
    expect(published.status).toBe('published');
    expect(serialsOf(published.crl!.crlPem)).toEqual(new Set([norm(first.serial)]));
    const state = stateOf(ca.id);
    expect(state.verifiedCrlId).toBe(published.crl!.id);
    expect(state.verifiedGeneration).toBeLessThan(state.changeGeneration);
    const res = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(serialsOf(res.body)).toEqual(new Set([norm(first.serial), norm(second.serial)]));
    expectOrderedHistory(ca.id, ca.pem);
  });

  it('an expired verified CRL, a CRL row from elsewhere and a deleted CRL row leave the fast path', async () => {
    const ca = await makeCa('Fast Expiry CA');
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    const verified = stateOf(ca.id);
    expect(verified.verifiedGeneration).toBe(verified.changeGeneration);
    // Expired: nextUpdate in the past (the trigger also counts the update; the check reads nextUpdate itself).
    db.update(crls).set({ nextUpdate: new Date(Date.now() - 1_000) }).where(eq(crls.caId, ca.id)).run();
    const count = crlRows(ca.id).length;
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(crlRows(ca.id)).toHaveLength(count + 1);
    // The newest row is not the verified one: full check (and no new CRL when it is current).
    const top = crlRows(ca.id).at(-1)!;
    db.insert(crls).values({ ...top, id: randomUUID(), crlNumber: top.crlNumber + 1, createdAt: new Date() }).run();
    const spy = countSnapshots();
    try {
      await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('the first background pass of a process checks a verified CRL against the database once', async () => {
    const ca = await makeCa('Full Pass CA');
    const [leaf] = makeLeaves(ca.id, 1);
    await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    // A wrong verification (for example made by an older version): the generation matches, the entries do not.
    db.update(certificates).set({ status: 'revoked', revocationDate: new Date(), revocationReason: 'keyCompromise' }).where(eq(certificates.id, leaf.id)).run();
    const g = stateOf(ca.id).changeGeneration;
    db.update(crlPublication).set({ verifiedGeneration: g }).where(eq(crlPublication.caId, ca.id)).run();
    const stale = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(serialsOf(stale.body).has(norm(leaf.serial))).toBe(false);
    await new CRLService().reconcile(ctx, { full: true });
    const fresh = await server.inject({ method: 'GET', url: `/crl/${ca.id}.crl` });
    expect(serialsOf(fresh.body).has(norm(leaf.serial))).toBe(true);
  });
});

describe('CRL publication: waits while the lease is busy or the signing fails', () => {
  it('a revocation and a manual generation do not wait 30 s behind a lease while the signing fails; busy gives a safe Retry-After', async () => {
    const ca = await makeCa('Failing Lease CA');
    const [leaf] = makeLeaves(ca.id, 1);
    // Another process holds the lease (it hangs on OpenBao), and the last signing failed.
    db.update(crlPublication)
      .set({ lease: 'other-process', leaseUntil: new Date(Date.now() + 20_000), failureCount: 1, lastFailureAt: new Date(Date.now() - 60_000) })
      .where(eq(crlPublication.caId, ca.id))
      .run();
    let started = Date.now();
    const revoked = await getCertificateService().revoke(ctx, { id: leaf.id, reason: 'keyCompromise' });
    expect(revoked.status).toBe('revoked');
    expect(Date.now() - started).toBeLessThan(5_000);

    started = Date.now();
    const busy = await getCRLService().generate(ctx, { caId: ca.id }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(busy).toBeInstanceOf(CRLPublicationBusyError);
    const retry = (busy as CRLPublicationBusyError).retryAfterSeconds;
    expect(retry).toBeGreaterThanOrEqual(15);
    expect(retry).toBeLessThanOrEqual(CRL_LEASE_SECONDS);

    // The lease ends: the revocation is published by the next download.
    db.update(crlPublication).set({ lease: null, leaseUntil: null }).where(eq(crlPublication.caId, ca.id)).run();
    const result = await getCRLService().refreshForDistribution(ctx, ca.id);
    expect(serialsOf(result.crl!.crlPem).has(norm(leaf.serial))).toBe(true);
  });

  it('the holder renews its lease while it signs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const ca = await makeCa('Renew Lease CA');
      const release = store.holdNextSign();
      const calls = store.signCalls;
      const call = getCRLService().generate(ctx, { caId: ca.id });
      await vi.waitFor(() => expect(store.signCalls).toBe(calls + 1));
      db.update(crlPublication).set({ leaseUntil: new Date(Date.now() + 1_000) }).where(eq(crlPublication.caId, ca.id)).run();
      vi.advanceTimersByTime(5_000);
      expect(stateOf(ca.id).leaseUntil!.getTime()).toBeGreaterThan(Date.now() + (CRL_LEASE_SECONDS - 2) * 1000);
      release();
      await call;
      expect(stateOf(ca.id).lease).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
