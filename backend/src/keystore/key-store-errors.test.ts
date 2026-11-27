/**
 * Key store outages and refusals reach API clients as stable, safe errors (TASK-288):
 * sealed / down / token refused -> 503 KEY_STORE_UNAVAILABLE (+ Retry-After), a legacy Cosmian
 * id -> 409 KEY_MIGRATION_REQUIRED, a refused export -> 403. The OpenBao detail never leaves the
 * server. A create that OpenBao refused leaves no pending key rows, and the next create after
 * recovery makes exactly one CA.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../db/client.js';
import { certificateAuthorities, certificates, crls, keystoreObjects } from '../db/schema.js';
import { MemoryKeyStore } from '../test/memory-keystore.js';
import { OpenBaoTransitClient, OpenBaoTransitConfigError, OpenBaoTransitError, type OpenBaoTransitConfig } from '../openbao/x509-transit.js';
import { CAOperationError } from '../services/ca.service.js';
import {
  KeyExportDeniedError, KeyStoreObjectNotFoundError, KeyStoreUnavailableError, keyCreationNotStarted, keyStoreErrorResponse, toKeyStoreError,
} from './errors.js';
import { X509KeyStoreService, setX509KeyStoreForTests } from './x509-store.js';
import type { KeyAlg, KeyRef, KeyStoreState, SignHash } from './types.js';
import { registerRestApi } from '../rest/index.js';
import { appRouter } from '../trpc/router.js';
import { createContext } from '../trpc/context.js';
import { keyStoreResponseMeta } from '../trpc/key-store-errors.js';

type Fault = { status: number; detail?: string; notCreated?: boolean } | null;

/** Memory key store whose Transit calls fail like OpenBao when `fault` is set. */
class FlakyKeyStore extends MemoryKeyStore {
  fault: Fault = null;
  exportStatus: number | null = null;
  private fail(path: string): void {
    if (!this.fault) return;
    const error = new OpenBaoTransitError(this.fault.status, path, this.fault.detail ?? 'Vault is sealed');
    if (this.fault.notCreated) error.keyNotCreated = true;
    throw error;
  }
  override async createKey(o: { name: string; alg: KeyAlg; exportable: boolean }) { this.fail('keys/<name>'); return super.createKey(o); }
  override async sign(ref: KeyRef, data: Buffer, hash: SignHash) { this.fail('sign/<name>'); return super.sign(ref, data, hash); }
  override async exportPrivateKeyPkcs8(ref: KeyRef) {
    if (this.exportStatus) throw new OpenBaoTransitError(this.exportStatus, 'export/signing-key/<name>', 'permission denied');
    this.fail('export/signing-key/<name>');
    return super.exportPrivateKeyPkcs8(ref);
  }
  override async status(): Promise<KeyStoreState> {
    if (!this.fault) return 'ready';
    return this.fault.status === 403 ? 'unauthorized' : this.fault.status === 501 ? 'uninitialized' : this.fault.status === 503 ? 'sealed' : 'unavailable';
  }
}

const SEALED: Fault = { status: 503, detail: 'Vault is sealed', notCreated: true };
const store = new FlakyKeyStore('test-mount', true);
const createdCaIds: string[] = [];
const createdCertIds: string[] = [];

function caPayload(cn: string) {
  return { subject: { commonName: cn, organization: 'Key Store Errors', country: 'ES' }, keyAlgorithm: 'RSA-2048', validityYears: 2 };
}

describe('key store error mapping', () => {
  const transit = (status: number, path = 'sign/<name>', detail = '') => new OpenBaoTransitError(status, path, detail);

  it.each([
    [503, 'Vault is sealed', 'sealed'],
    [503, 'standby node', 'unavailable'],
    [501, '', 'uninitialized'],
    [0, 'ECONNREFUSED', 'unavailable'],
    [502, '', 'unavailable'],
    [504, '', 'unavailable'],
    [429, '', 'unavailable'],
    [403, 'permission denied', 'unauthorized'],
  ])('maps OpenBao %i (%s) to 503 KEY_STORE_UNAVAILABLE (%s)', (status, detail, reason) => {
    const converted = toKeyStoreError(transit(status, 'sign/<name>', detail), 'sign');
    expect(converted).toBeInstanceOf(KeyStoreUnavailableError);
    expect((converted as KeyStoreUnavailableError).reason).toBe(reason);
    const response = keyStoreErrorResponse(converted);
    expect(response).toEqual({ status: 503, code: 'KEY_STORE_UNAVAILABLE', message: 'The key store is unavailable; retry later', retryAfterSeconds: 30 });
    expect(JSON.stringify(response)).not.toContain(detail || 'never');
  });

  it('maps an unreadable token file and missing settings to 503', () => {
    expect((toKeyStoreError(transit(0, 'token', 'token file unreadable'), 'create') as KeyStoreUnavailableError).reason).toBe('unauthorized');
    expect((toKeyStoreError(new OpenBaoTransitConfigError('OPENBAO_ADDR is required'), 'sign') as KeyStoreUnavailableError).reason).toBe('not_configured');
  });

  it('maps a refused export to 403 KEY_EXPORT_DENIED and keeps other errors internal', () => {
    for (const status of [400, 403]) {
      const converted = toKeyStoreError(transit(status, 'export/signing-key/<name>', 'export is disabled'), 'export');
      expect(converted).toBeInstanceOf(KeyExportDeniedError);
      expect(keyStoreErrorResponse(converted)).toMatchObject({ status: 403, code: 'KEY_EXPORT_DENIED' });
    }
    const internal = transit(500, 'sign/<name>', 'internal');
    expect(toKeyStoreError(internal, 'sign')).toBe(internal);
    expect(keyStoreErrorResponse(internal)).toBeNull();
    expect(keyStoreErrorResponse(new Error('other'))).toBeNull();
  });

  it('finds the key store error in the cause chain of a service error', () => {
    const wrapped = new CAOperationError('create', new KeyStoreUnavailableError('sealed'));
    expect(keyStoreErrorResponse(wrapped)?.status).toBe(503);
    expect(keyStoreErrorResponse(new CAOperationError('create', new KeyStoreObjectNotFoundError('legacy-id')))).toEqual({
      status: 409, code: 'KEY_MIGRATION_REQUIRED', message: 'The key of this object is not in the OpenBao key store yet; run the key migration',
    });
  });

  it('marks a Transit create that OpenBao refused as not created, and a lost answer as unknown', async () => {
    const cfg: OpenBaoTransitConfig = { addr: new URL('https://openbao.invalid:8200'), tokenFile: '/nonexistent', timeoutMs: 1000, mount: 'pki-manager', caKeysExportable: false };
    const run = async (respond: (method: string) => never | { status: number; json: Record<string, unknown> }) => {
      const client = new OpenBaoTransitClient(cfg);
      (client as unknown as { call: (method: string) => Promise<unknown> }).call = async (method: string) => respond(method);
      return client.createKey('pki-manager', `x509-ca-${randomUUID()}`, 'ecdsa-p256', false).catch((e: unknown) => e);
    };
    // The first read fails (sealed): the POST is never sent.
    expect(keyCreationNotStarted(await run(() => { throw transit(503, 'keys/<name>', 'Vault is sealed'); }))).toBe(true);
    // The read says "no key", the POST is refused with an answer.
    expect(keyCreationNotStarted(await run((m) => { throw m === 'GET' ? transit(404, 'keys/<name>') : transit(403, 'keys/<name>'); }))).toBe(true);
    // The read says "no key", the POST has no answer: OpenBao may have created the key.
    expect(keyCreationNotStarted(await run((m) => { throw m === 'GET' ? transit(404, 'keys/<name>') : transit(0, 'keys/<name>', 'timeout'); }))).toBe(false);
  });
});

describe('key store errors at the API edges', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    setX509KeyStoreForTests(new X509KeyStoreService(store));
    app = Fastify({ logger: false });
    await registerRestApi(app);
    await app.register(fastifyTRPCPlugin, { prefix: '/trpc', trpcOptions: { router: appRouter, createContext, responseMeta: keyStoreResponseMeta } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    setX509KeyStoreForTests(undefined);
    if (createdCertIds.length) await db.delete(certificates).where(inArray(certificates.id, createdCertIds));
    if (createdCaIds.length) {
      await db.delete(certificates).where(inArray(certificates.caId, createdCaIds));
      await db.delete(crls).where(inArray(crls.caId, createdCaIds));
      await db.delete(certificateAuthorities).where(inArray(certificateAuthorities.id, createdCaIds));
    }
  });

  beforeEach(() => { store.fault = null; store.exportStatus = null; });

  async function createCa(cn: string) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/cas/', payload: caPayload(cn) });
    if (res.statusCode === 201) createdCaIds.push(res.json<{ id: string }>().id);
    return res;
  }

  const pendingRows = async () => db.select().from(keystoreObjects).where(eq(keystoreObjects.state, 'pending'));

  it('REST CA create on a sealed key store: 503 + Retry-After, no detail, no pending rows; one CA after recovery', async () => {
    const cn = `Sealed CA ${randomUUID().slice(0, 8)}`;
    const before = (await pendingRows()).length;
    store.fault = SEALED;
    const res = await createCa(cn);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toEqual({ error: { code: 'KEY_STORE_UNAVAILABLE', message: 'The key store is unavailable; retry later' } });
    expect(res.body).not.toMatch(/sealed|OpenBao|HTTP 503/i);
    expect((await pendingRows()).length).toBe(before);

    // Retry of the same request after the unseal: exactly one CA, no leftover rows.
    store.fault = null;
    const retry = await createCa(cn);
    expect(retry.statusCode, retry.body).toBe(201);
    const rows = await db.select().from(certificateAuthorities).where(like(certificateAuthorities.subjectDn, `CN=${cn},%`));
    expect(rows).toHaveLength(1);
    expect((await pendingRows()).length).toBe(before);
  });

  it('keeps the pending rows when the create outcome is unknown', async () => {
    const before = (await pendingRows()).length;
    store.fault = { status: 0, detail: 'socket hang up' };
    const res = await createCa(`Lost Answer CA ${randomUUID().slice(0, 8)}`);
    expect(res.statusCode).toBe(503);
    const after = await pendingRows();
    expect(after.length).toBe(before + 2);
    const fresh = after.filter((r) => r.keyName?.startsWith('x509-ca-'));
    await db.delete(keystoreObjects).where(inArray(keystoreObjects.id, fresh.slice(-2).map((r) => r.id)));
  });

  it('REST CRL generation and leaf issuance on a sealed key store: 503', async () => {
    store.fault = null;
    const ca = await createCa(`CRL CA ${randomUUID().slice(0, 8)}`);
    expect(ca.statusCode, ca.body).toBe(201);
    const caId = ca.json<{ id: string }>().id;

    store.fault = SEALED;
    const crl = await app.inject({ method: 'POST', url: `/api/v1/cas/${caId}/crls`, payload: {} });
    expect(crl.statusCode, crl.body).toBe(503);
    expect(crl.json().error.code).toBe('KEY_STORE_UNAVAILABLE');
    expect(crl.headers['retry-after']).toBe('30');

    const issue = await app.inject({
      method: 'POST', url: '/api/v1/certificates/',
      payload: { caId, subject: { commonName: 'leaf.example.com', organization: 'T', country: 'ES' }, certificateType: 'server', sanDns: ['leaf.example.com'], keyAlgorithm: 'RSA-2048', validityDays: 30 },
    });
    expect(issue.statusCode, issue.body).toBe(503);
    expect(issue.json().error.code).toBe('KEY_STORE_UNAVAILABLE');

    store.fault = { status: 403, detail: 'permission denied' };
    const denied = await app.inject({ method: 'POST', url: `/api/v1/cas/${caId}/crls`, payload: {} });
    expect(denied.statusCode).toBe(503);
    expect(denied.body).not.toContain('permission denied');

    store.fault = null;
    const recovered = await app.inject({ method: 'POST', url: `/api/v1/cas/${caId}/crls`, payload: {} });
    expect(recovered.statusCode, recovered.body).toBe(201);
  });

  it('tRPC CA create on a sealed key store: SERVICE_UNAVAILABLE with appCode', async () => {
    store.fault = SEALED;
    const res = await app.inject({ method: 'POST', url: '/trpc/ca.create', payload: caPayload(`tRPC Sealed ${randomUUID().slice(0, 8)}`) });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    const error = res.json<{ error: { message: string; data: { code: string; appCode?: string; httpStatus: number } } }>().error;
    expect(error.data.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.data.appCode).toBe('KEY_STORE_UNAVAILABLE');
    expect(error.message).toBe('The key store is unavailable; retry later');
  });

  it('un-migrated X.509 references: 409 KEY_MIGRATION_REQUIRED on REST and tRPC', async () => {
    store.fault = null;
    const ca = await createCa(`Legacy CA ${randomUUID().slice(0, 8)}`);
    const caId = ca.json<{ id: string }>().id;
    const certId = randomUUID();
    const [caRow] = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
    await db.insert(certificates).values({
      id: certId, caId, subjectDn: 'CN=legacy.example.com,O=T,C=ES', serialNumber: randomUUID().replace(/-/g, ''), certificateType: 'server',
      notBefore: new Date(), notAfter: new Date(Date.now() + 86400e3), kmsCertificateId: `cosmian-${randomUUID()}`, kmsKeyId: `cosmian-${randomUUID()}`,
      status: 'active', createdAt: new Date(), updatedAt: new Date(),
    });
    createdCertIds.push(certId);

    const rest = await app.inject({ method: 'GET', url: `/api/v1/certificates/${certId}/download?format=key-pem` });
    expect(rest.statusCode, rest.body).toBe(409);
    expect(rest.json().error.code).toBe('KEY_MIGRATION_REQUIRED');

    const trpc = await app.inject({ method: 'GET', url: `/trpc/certificate.download?input=${encodeURIComponent(JSON.stringify({ id: certId, format: 'pem' }))}` });
    expect(trpc.statusCode, trpc.body).toBe(409);
    expect(trpc.json().error.data.appCode).toBe('KEY_MIGRATION_REQUIRED');

    // A legacy CA certificate id on the public CA download: 409, not 500.
    await db.update(certificateAuthorities).set({ kmsCertificateId: `cosmian-${randomUUID()}` }).where(eq(certificateAuthorities.id, caId));
    try {
      const download = await app.inject({ method: 'GET', url: `/api/v1/cas/${caId}/download?format=pem` });
      expect(download.statusCode, download.body).toBe(409);
      expect(download.json().error.code).toBe('KEY_MIGRATION_REQUIRED');
    } finally {
      await db.update(certificateAuthorities).set({ kmsCertificateId: caRow.kmsCertificateId }).where(eq(certificateAuthorities.id, caId));
    }
  });

  it('a refused leaf key export is 403 KEY_EXPORT_DENIED; a sealed export is 503', async () => {
    store.fault = null;
    const ca = await createCa(`Export CA ${randomUUID().slice(0, 8)}`);
    const caId = ca.json<{ id: string }>().id;
    const issue = await app.inject({
      method: 'POST', url: '/api/v1/certificates/',
      payload: { caId, subject: { commonName: 'export.example.com', organization: 'T', country: 'ES' }, certificateType: 'server', sanDns: ['export.example.com'], keyAlgorithm: 'RSA-2048', validityDays: 30 },
    });
    expect(issue.statusCode, issue.body).toBe(201);
    const certId = issue.json<{ id: string }>().id;

    store.exportStatus = 403;
    const denied = await app.inject({ method: 'GET', url: `/api/v1/certificates/${certId}/download?format=key-pem` });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe('KEY_EXPORT_DENIED');

    store.exportStatus = null;
    store.fault = SEALED;
    const sealed = await app.inject({ method: 'GET', url: `/api/v1/certificates/${certId}/download?format=key-pem` });
    expect(sealed.statusCode).toBe(503);

    const bulk = await app.inject({ method: 'POST', url: '/api/v1/certificates/bulk/download', payload: { certificateIds: [certId], format: 'pem-key', encryptPrivateKey: false } });
    expect(bulk.statusCode, bulk.body).toBe(503);
    expect(bulk.json().error.code).toBe('KEY_STORE_UNAVAILABLE');

    store.fault = null;
    const ok = await app.inject({ method: 'GET', url: `/api/v1/certificates/${certId}/download?format=key-pem` });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('bulk issuance reports the safe message per row', async () => {
    store.fault = null;
    const ca = await createCa(`Bulk CA ${randomUUID().slice(0, 8)}`);
    const caId = ca.json<{ id: string }>().id;
    store.fault = SEALED;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/certificates/bulk/issue',
      payload: { caId, csvData: 'server,bulk1.example.com,T,ES,bulk1.example.com,30' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ results: Array<{ success: boolean; error?: string }> }>();
    expect(res.body).not.toMatch(/sealed|HTTP 503/i);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toContain('The key store is unavailable');
  });

  it('operator diagnostics report the key store state; the health probe stays a liveness check', async () => {
    for (const [fault, state] of [[null, 'ready'], [SEALED, 'sealed'], [{ status: 501 }, 'uninitialized'], [{ status: 403 }, 'unauthorized'], [{ status: 0 }, 'unavailable']] as const) {
      store.fault = fault;
      const res = await app.inject({ method: 'GET', url: '/api/v1/diagnostics/key-store' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: 'openbao', configured: true, state });
      const trpc = await app.inject({ method: 'GET', url: '/trpc/dashboard.keyStoreStatus' });
      expect(trpc.json().result.data).toMatchObject({ provider: 'openbao', configured: true, state });
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json().status).toBe('ok');
      expect(health.body).not.toContain(state === 'ready' ? 'never' : state);
    }
  });
});
