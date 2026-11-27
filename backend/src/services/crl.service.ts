/**
 * CRL service: builds, signs and publishes the X.509 v2 CRL of each CA.
 *
 * Publication protocol (TASK-288):
 * - One publication at a time per CA: a queue per CA in the process, and the lease of the CA's
 *   `crl_publication` row between processes that share the database. The signing request to
 *   OpenBao runs with no SQLite transaction open.
 * - The publisher reads the state after it holds the lease, signs CRL number N and inserts it in
 *   one IMMEDIATE transaction only when it still holds the lease and N is still the next number.
 *   Else it discards the signed CRL (it was never stored or served) and starts again.
 * - N is above the high-water mark `last_number` and above every stored row, so a new number
 *   never repeats an old one, also an old duplicate number from before migration 0018.
 * - Each CRL lists every entry of the newest published CRL (a deleted certificate stays revoked),
 *   plus the revoked certificates of the database and the revocations of deleted certificates
 *   (`crl_deleted_revocations`, written in the transaction of the delete), minus the entries that
 *   an operator removed on purpose (`crl_entry_removals`). So a later CRL lists every earlier
 *   revocation, also one that no CRL listed before its certificate was deleted.
 * - Fast path (migration 0019): database triggers add 1 to `crl_publication.change_generation` on
 *   every write that can change these entries. A check that finds the CRL current records the
 *   generation and the CRL row id (`verified_generation`, `verified_crl_id`). While both still
 *   match, the CRL is current without a read of the certificates: a download reads the
 *   publication row and the newest CRL row. Every process and every write path shares this.
 * - The newest CRL is current when it lists exactly these entries and is not expired. When the
 *   signing fails, the revocation stays in the database and the CRL stays as it was (pending).
 *   The next change, the next CRL download (`/crl/<caId>`) and the background job
 *   (`crl-reconciler.ts`) publish it. Downloads and the job wait for the retry time.
 */
import { createHash, randomUUID } from 'node:crypto';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { eq, and, desc, sql, ne, or, isNull, lte, inArray } from 'drizzle-orm';
import {
  certificateAuthorities,
  certificates,
  crlDeletedRevocations,
  crlEntryRemovals,
  crlPublication,
  crls,
  type CertificateAuthority,
  type Crl,
  type CrlPublication,
} from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { parseCertificate } from '../crypto/x509.js';
import { generateCRLWithSigner, normalizeSerialHex, parseCRL } from '../crypto/crl.js';
import { getDefaultSignatureAlgorithm } from '../crypto/keys.js';
import { createAuditLog } from '../lib/audit.js';
import { KeyStoreUnavailableError, isKeyStoreUnavailable } from '../keystore/errors.js';
import { logger } from '../lib/logger.js';
import { CRLReason } from '../crypto/types.js';
import type { KeyAlgorithm, SignatureAlgorithm } from '../crypto/types.js';
import type { ServiceContext } from './types.js';

/**
 * Map a stored revocationReason string (e.g. "key_compromise" or "key_compromise: lost laptop")
 * to an RFC 5280 CRL reason code. Unknown/empty reasons fall back to UNSPECIFIED (omitted from the CRL).
 */
export function mapRevocationReason(reason: string | null | undefined): CRLReason {
  if (!reason) return CRLReason.UNSPECIFIED;
  const key = reason.split(':')[0].trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (key) {
    case 'key_compromise':
    case 'keycompromise':
      return CRLReason.KEY_COMPROMISE;
    case 'ca_compromise':
    case 'cacompromise':
      return CRLReason.CA_COMPROMISE;
    case 'affiliation_changed':
    case 'affiliationchanged':
      return CRLReason.AFFILIATION_CHANGED;
    case 'superseded':
      return CRLReason.SUPERSEDED;
    case 'cessation_of_operation':
    case 'cessationofoperation':
      return CRLReason.CESSATION_OF_OPERATION;
    case 'certificate_hold':
    case 'certificatehold':
      return CRLReason.CERTIFICATE_HOLD;
    case 'privilege_withdrawn':
    case 'privilegewithdrawn':
      return CRLReason.PRIVILEGE_WITHDRAWN;
    case 'aa_compromise':
    case 'aacompromise':
      return CRLReason.AA_COMPROMISE;
    default:
      return CRLReason.UNSPECIFIED;
  }
}

/**
 * Determine the CRL signature algorithm. Prefer the CA's recorded keyAlgorithm; otherwise
 * infer it from the CA key (RSA ≥4096 / EC P-384 use SHA-384, else SHA-256).
 */
export function resolveSignatureAlgorithm(
  caKeyAlgorithm: string | null | undefined,
  /** CA certificate PEM, public key PEM or private key PEM: only the key type and size are read. */
  keyPem: string,
): SignatureAlgorithm {
  const known: KeyAlgorithm[] = ['RSA-2048', 'RSA-4096', 'ECDSA-P256', 'ECDSA-P384'];
  if (caKeyAlgorithm && (known as string[]).includes(caKeyAlgorithm)) {
    return getDefaultSignatureAlgorithm(caKeyAlgorithm as KeyAlgorithm);
  }
  const key = keyPem.includes('CERTIFICATE')
    ? new X509Certificate(keyPem).publicKey
    : keyPem.includes('PRIVATE KEY') ? createPrivateKey(keyPem) : createPublicKey(keyPem);
  if (key.asymmetricKeyType === 'ec') {
    const curve = (key.asymmetricKeyDetails?.namedCurve || '').toLowerCase();
    return curve.includes('384') ? 'SHA384-ECDSA' : 'SHA256-ECDSA';
  }
  const modulusBits = key.asymmetricKeyDetails?.modulusLength ?? 2048;
  return modulusBits >= 4096 ? 'SHA384-RSA' : 'SHA256-RSA';
}

// ---------------------------------------------------------------------------------------------
// Publication settings
// ---------------------------------------------------------------------------------------------

/**
 * Lease time. The holder renews it every `CRL_LEASE_RENEW_MS` while it builds and signs, so a
 * long OpenBao request (`OPENBAO_TIMEOUT_MS` is at most 60 s) keeps it, and the lease of a stopped
 * process blocks the CA for at most this time (it was 120 s before the renewal).
 */
export const CRL_LEASE_SECONDS = 30;
const CRL_LEASE_RENEW_MS = 5_000;
/** Wait for a busy publication: after a change or a manual request, and for a download or the job. */
const WAIT_EXPLICIT_MS = 30_000;
const WAIT_PASSIVE_MS = 2_000;
/**
 * Wait of a change or a manual request while the last signing of the CA failed (OpenBao down):
 * the publisher ahead of it most likely fails or hangs too, so the call does not wait 30 s. The
 * change stays in the database and the generation marks the CRL as not verified: downloads and
 * the background job publish it.
 */
const WAIT_FAILING_MS = 2_000;
const LEASE_POLL_MS = 100;
/** Backoff of downloads and of the background job after a failed signing: 5 s, doubled, at most 60 s. */
const RETRY_BASE_SECONDS = 5;
const RETRY_MAX_SECONDS = 60;
/** Cache time of a CRL that does not list the database state yet. */
export const CRL_PENDING_MAX_AGE_SECONDS = 30;
const DEFAULT_NEXT_UPDATE_DAYS = 7;

/**
 * Why a call publishes: `manual` (CRL generate request, CA revocation), `change` (after a
 * revocation, a removal or a CA creation), `distribution` (a CRL download), `reconcile` (the job).
 */
export type CRLPublicationTrigger = 'manual' | 'change' | 'distribution' | 'reconcile';

/** Why the newest CRL is not current: no CRL, empty PEM (issue #48), past nextUpdate, other entries. */
export type CRLPublicationNeed = 'missing' | 'empty' | 'expired' | 'entries';

export interface CRLPublicationResult {
  /**
   * `current`: the newest CRL lists the database state. `published`: this call published a new
   * CRL. `pending`: the newest CRL is not current (the signing failed, the retry time is not
   * reached, the CA status does not permit a CRL, or another publication kept the slot).
   */
  status: 'current' | 'published' | 'pending';
  /** Why the CRL was not current at the start of the call; null when it was current. */
  need: CRLPublicationNeed | null;
  /** The newest CRL row after the call: the CRL that a client gets. */
  crl: Crl | null;
  /** The signing failure of this call. */
  error?: unknown;
  /** The time after which downloads and the background job try again. */
  retryAfter?: Date | null;
}

interface PublishOptions {
  force: boolean;
  /** Start of the call (ms): a failure recorded after it means OpenBao failed while the call waited. */
  startedAt?: number;
  trigger: CRLPublicationTrigger;
  nextUpdateDays: number;
  waitMs: number;
  /** Downloads and the job: obey the retry time and audit only the first failure of a series. */
  passive: boolean;
}

interface Entry {
  /** Normalized hex (`normalizeSerialHex`). */
  serial: string;
  /** Whole seconds, as the CRL encodes it. */
  date: Date;
  reason: CRLReason;
}

interface Snapshot {
  state: CrlPublication;
  /** `change_generation`, read before every other row of the snapshot. */
  generation: number;
  /** The newest row: highest number, then newest, then id (old rows can share a number). */
  served: Crl | null;
  need: CRLPublicationNeed | null;
  /** The entries of the next CRL, sorted by serial. */
  entries: Entry[];
  nextNumber: number;
}

type Database = ServiceContext['db'];

const bySerial = (a: Entry, b: Entry) => (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0);
const wholeSeconds = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Text of a signing failure for logs, audit and `last_error`: names the key store outage reason. */
function failureText(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof KeyStoreUnavailableError) return `${current.message} (${current.reason})`;
    current = (current as { cause?: unknown }).cause;
  }
  return message(error);
}

/** One line per entry, sorted by serial: the content that `entries_sha256` covers. */
function canonical(entries: Entry[]): string {
  return [...entries]
    .sort(bySerial)
    .map((e) => `${e.serial} ${Math.floor(e.date.getTime() / 1000)} ${e.reason}`)
    .join('\n');
}

export function crlEntriesSha256(entries: Entry[]): string {
  return createHash('sha256').update(canonical(entries)).digest('hex');
}

// Entries of stored CRLs. A row never changes after its insert, so the parse is kept per row id.
const ENTRY_CACHE_SIZE = 128;
const entryCache = new Map<string, Entry[] | null>();

function entriesOf(row: Pick<Crl, 'id' | 'crlPem'>): Entry[] | null {
  if (!row.crlPem) return null;
  if (entryCache.has(row.id)) {
    const cached = entryCache.get(row.id)!;
    entryCache.delete(row.id);
    entryCache.set(row.id, cached);
    return cached;
  }
  let value: Entry[] | null;
  try {
    value = parseCRL(row.crlPem).revokedCertificates.map((e) => ({
      serial: e.serialNumber,
      date: wholeSeconds(e.revocationDate),
      reason: e.reason ?? CRLReason.UNSPECIFIED,
    }));
  } catch (error) {
    logger.warn({ crlId: row.id, error: message(error) }, 'A stored CRL cannot be parsed: its entries are not read');
    value = null;
  }
  entryCache.set(row.id, value);
  if (entryCache.size > ENTRY_CACHE_SIZE) entryCache.delete(entryCache.keys().next().value as string);
  return value;
}

// Types for CRL Service inputs and outputs
export interface GenerateCRLParams {
  caId: string;
  nextUpdateDays?: number;
}

export interface GenerateCRLResult {
  id: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  revokedCount: number;
  note?: string;
}

export interface GetCRLParams {
  caId: string;
  crlNumber?: number;
}

export interface RevokedCertificateEntry {
  serialNumber: string;
  revocationDate: string | null;
  revocationReason: string | null;
}

export interface CRLDetails {
  id: string;
  caId: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  validityStatus: 'valid' | 'expired';
  revokedCount: number;
  crlPem: string | null;
  crlDer: string | null;
  revokedCertificates: RevokedCertificateEntry[];
  createdAt: string;
}

export interface ListCRLsParams {
  caId: string;
  limit?: number;
  offset?: number;
}

export interface CRLListItem {
  id: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  validityStatus: 'valid' | 'expired';
  revokedCount: number;
  createdAt: string;
}

export interface ListCRLsResult {
  items: CRLListItem[];
  totalCount: number;
  limit: number;
  offset: number;
}

export interface CRLReconcileResult {
  checked: number;
  published: number;
  pending: number;
  /** The pass stopped early: the key store was unavailable. */
  stopped?: boolean;
}

// Re-export ServiceContext for consumers that import from this module
export type { ServiceContext };

/**
 * CRL Service - Business logic for Certificate Revocation List operations
 * Shared between tRPC and REST API layers
 */
export class CRLService {
  /** Tail of the publication queue of each CA in this process. */
  private readonly queues = new Map<string, Promise<void>>();

  /**
   * Generate a new CRL for a CA (CRL generate request, CA revocation). It always publishes a new
   * CRL number, after any publication that is in progress. Throws when the signing fails.
   */
  async generate(ctx: ServiceContext, params: GenerateCRLParams): Promise<GenerateCRLResult> {
    const result = await this.publish(ctx, params.caId, {
      force: true,
      trigger: 'manual',
      nextUpdateDays: params.nextUpdateDays ?? DEFAULT_NEXT_UPDATE_DAYS,
      waitMs: WAIT_EXPLICIT_MS,
      passive: false,
    });
    if (result.status === 'published' && result.crl) {
      const crl = result.crl;
      return {
        id: crl.id,
        crlNumber: crl.crlNumber,
        thisUpdate: crl.thisUpdate.toISOString(),
        nextUpdate: crl.nextUpdate.toISOString(),
        revokedCount: crl.revokedCount,
      };
    }
    if (result.error !== undefined) throw new CRLOperationError('generate', result.error);
    throw new CRLPublicationBusyError(params.caId, this.busyRetrySeconds(ctx.db, params.caId));
  }

  /**
   * Make the CRL of a CA current after a change (revocation, removal, CA creation), best-effort:
   * logs and swallows errors so that a CRL problem (e.g. OpenBao sealed) never fails the
   * caller's primary operation. Publishes only when the newest CRL is not current. Returns true
   * when the newest CRL is current after the call.
   */
  async regenerateForCa(ctx: ServiceContext, caId: string): Promise<boolean> {
    try {
      const result = await this.publish(ctx, caId, {
        force: false,
        trigger: 'change',
        nextUpdateDays: DEFAULT_NEXT_UPDATE_DAYS,
        waitMs: WAIT_EXPLICIT_MS,
        passive: false,
      });
      return result.status !== 'pending';
    } catch (error) {
      logger.warn(
        { caId, error: message(error) },
        'CRL regeneration failed (best-effort; primary operation unaffected)'
      );
      return false;
    }
  }

  /**
   * Make the CRL of a CA current before it is served (public CRL download), best-effort and
   * quick: obeys the retry time after a failed signing, waits at most 2 s for a publication in
   * progress, and never throws for a known CA. The result tells which CRL to serve and whether
   * it is pending.
   */
  async refreshForDistribution(ctx: ServiceContext, caId: string): Promise<CRLPublicationResult> {
    return this.publishPassive(ctx, caId, 'distribution');
  }

  /**
   * Background reconciliation (crl-reconciler.ts): make the CRL of every CA current that can have
   * one. Publishes what a failed signing or a stopped process left pending, and expired CRLs.
   */
  async reconcile(ctx: ServiceContext, options: { full?: boolean } = {}): Promise<CRLReconcileResult> {
    const cas = ctx.db
      .select({ id: certificateAuthorities.id })
      .from(certificateAuthorities)
      .where(inArray(certificateAuthorities.status, ['active', 'revoked']))
      .all();
    const result: CRLReconcileResult = { checked: 0, published: 0, pending: 0 };
    for (const ca of cas) {
      result.checked++;
      try {
        // `full`: the first pass of a process checks every CA against the database once, also when
        // its verified generation matches (for example after an upgrade that changed the rules).
        if (options.full) this.recheck(ctx.db, ca.id);
        const outcome = await this.publishPassive(ctx, ca.id, 'reconcile');
        if (outcome.status === 'published') result.published++;
        if (outcome.status === 'pending') result.pending++;
        // OpenBao is down for every CA: the next pass tries again, without one timeout per CA.
        if (outcome.error !== undefined && isKeyStoreUnavailable(outcome.error)) {
          result.stopped = true;
          break;
        }
      } catch (error) {
        if (!(error instanceof CRLCANotFoundError)) throw error; // deleted during the pass
      }
    }
    return result;
  }

  /**
   * Seconds after which a manual generation that found the CA busy can try again: the end of the
   * lease of the other publisher, or the retry time after a failed signing; 1 to 120 s.
   */
  private busyRetrySeconds(db: Database, caId: string): number {
    const state = db.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get();
    const now = Date.now();
    const until = Math.max(state?.leaseUntil?.getTime() ?? 0, state?.retryAfter?.getTime() ?? 0);
    const seconds = Math.ceil((until - now) / 1000);
    return Math.min(Math.max(seconds, 1), CRL_LEASE_SECONDS);
  }

  private async publishPassive(
    ctx: ServiceContext,
    caId: string,
    trigger: 'distribution' | 'reconcile',
  ): Promise<CRLPublicationResult> {
    try {
      return await this.publish(ctx, caId, {
        force: false,
        trigger,
        nextUpdateDays: DEFAULT_NEXT_UPDATE_DAYS,
        waitMs: WAIT_PASSIVE_MS,
        passive: true,
      });
    } catch (error) {
      if (error instanceof CRLCANotFoundError) throw error;
      logger.warn({ caId, trigger, error: message(error) }, 'CRL refresh failed');
      const served = this.newestRow(ctx.db, caId);
      return { status: 'pending', need: null, crl: served, error };
    }
  }

  private async publish(ctx: ServiceContext, caId: string, options: PublishOptions): Promise<CRLPublicationResult> {
    const ca = ctx.db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).get();
    if (!ca) throw new CRLCANotFoundError(caId);
    // A revoked CA can still publish its CRL; other states cannot sign.
    if (ca.status !== 'active' && ca.status !== 'revoked') {
      if (options.force) throw new CRLInvalidCAStatusError(caId, ca.status);
      const snapshot = this.snapshot(ctx.db, caId, new Date());
      return { status: snapshot.need ? 'pending' : 'current', need: snapshot.need, crl: snapshot.served };
    }
    // Fast path: the CRL was verified at the current generation and is not expired.
    if (!options.force) {
      const verified = this.verifiedRow(ctx.db, caId, new Date());
      if (verified) return { status: 'current', need: null, crl: verified };
    }
    let waitMs = options.waitMs;
    if (!options.passive && this.state(ctx.db, caId).failureCount > 0) waitMs = Math.min(waitMs, WAIT_FAILING_MS);
    const started = { ...options, waitMs, startedAt: Date.now() };
    const outcome = await this.inQueue(caId, waitMs, () => this.publishInTurn(ctx, ca, started));
    if (outcome !== QUEUE_TIMEOUT) return outcome;
    if (!options.force) {
      const verified = this.verifiedRow(ctx.db, caId, new Date());
      if (verified) return { status: 'current', need: null, crl: verified };
    }
    return { status: 'pending', need: null, crl: this.newestRow(ctx.db, caId) };
  }

  /**
   * Runs `fn` after the earlier calls of the same CA in this process. Returns QUEUE_TIMEOUT when
   * they take longer than `waitMs`; the order of the later calls stays the same.
   */
  private async inQueue<T>(caId: string, waitMs: number, fn: () => Promise<T>): Promise<T | typeof QUEUE_TIMEOUT> {
    const previous = this.queues.get(caId) ?? Promise.resolve();
    let finish!: () => void;
    const mine = new Promise<void>((resolve) => (finish = resolve));
    const tail = previous.then(() => mine);
    this.queues.set(caId, tail);
    let timer: NodeJS.Timeout | undefined;
    try {
      const turn = await Promise.race([
        previous.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), waitMs);
          timer.unref?.();
        }),
      ]);
      if (!turn) return QUEUE_TIMEOUT;
      return await fn();
    } finally {
      if (timer) clearTimeout(timer);
      finish();
      if (this.queues.get(caId) === tail) this.queues.delete(caId);
    }
  }

  private async publishInTurn(
    ctx: ServiceContext,
    ca: CertificateAuthority,
    options: PublishOptions,
  ): Promise<CRLPublicationResult> {
    const db = ctx.db;
    const deadline = Date.now() + options.waitMs;
    for (;;) {
      const now = new Date();
      // A publication ahead of this call can have made the CRL current (cheap check, no scan).
      if (!options.force) {
        const verified = this.verifiedRow(db, ca.id, now);
        if (verified) return { status: 'current', need: null, crl: verified };
      }
      const state = this.state(db, ca.id);
      // Downloads and the job wait for the retry time. A change waits for it only when a signing
      // failed while the call waited (OpenBao is still down): the queued calls do not repeat it.
      // The CRL is not verified here, so it is pending; the entries are not read.
      const failedWhileWaiting =
        !options.force &&
        state.lastFailureAt !== null &&
        state.lastFailureAt.getTime() >= wholeSeconds(new Date(options.startedAt ?? 0)).getTime();
      if ((options.passive || failedWhileWaiting) && state.retryAfter && state.retryAfter > now) {
        return { status: 'pending', need: null, crl: this.newestRow(db, ca.id), retryAfter: state.retryAfter };
      }

      const lease = this.takeLease(db, ca.id, now);
      if (!lease) {
        // Another process publishes for this CA. Its CRL can make this call unnecessary.
        if (Date.now() >= deadline) return { status: 'pending', need: null, crl: this.newestRow(db, ca.id) };
        await sleep(LEASE_POLL_MS + Math.floor(Math.random() * LEASE_POLL_MS));
        continue;
      }

      let outcome: CRLPublicationResult | 'lost';
      const renewal = setInterval(() => this.renewLease(db, ca.id, lease), CRL_LEASE_RENEW_MS);
      renewal.unref?.();
      try {
        outcome = await this.publishWithLease(ctx, ca, options, lease);
      } finally {
        clearInterval(renewal);
        // No-op when the commit or the failure record freed it, or when another publisher has it.
        this.releaseLease(db, ca.id, lease);
      }
      if (outcome !== 'lost') return outcome;
      // The lease expired and another publisher took it, or a row took the number. The signed
      // CRL was never stored: start again from the new state.
      if (Date.now() >= deadline) {
        const verified = options.force ? null : this.verifiedRow(db, ca.id, new Date());
        // A forced call did not publish its own CRL: that is pending also when the state is current.
        if (verified) return { status: 'current', need: null, crl: verified };
        return { status: 'pending', need: null, crl: this.newestRow(db, ca.id) };
      }
    }
  }

  /** One publication attempt under the lease. 'lost': the lease or the number moved on. */
  private async publishWithLease(
    ctx: ServiceContext,
    ca: CertificateAuthority,
    options: PublishOptions,
    lease: string,
  ): Promise<CRLPublicationResult | 'lost'> {
    const db = ctx.db;
    // The lease orders this publication after every earlier one: read the state again under it.
    const thisUpdate = wholeSeconds(new Date());
    const snapshot = this.snapshot(db, ca.id, thisUpdate);
    if (!snapshot.need && snapshot.served) this.markVerified(db, ca.id, snapshot.generation, snapshot.served.id);
    if (!options.force && !snapshot.need) return { status: 'current', need: null, crl: snapshot.served };
    const nextUpdate = new Date(thisUpdate.getTime() + options.nextUpdateDays * 24 * 60 * 60 * 1000);
    const crlId = randomUUID();
    const reason = snapshot.need ?? 'requested';

    let signed: { pem: string; signatureAlgorithm: SignatureAlgorithm };
    try {
      signed = await this.sign(ca, snapshot.nextNumber, snapshot.entries, thisUpdate, nextUpdate);
    } catch (error) {
      const failure = this.recordFailure(db, ca.id, lease, error);
      const log = { caId: ca.id, crlNumber: snapshot.nextNumber, trigger: options.trigger, reason, error: failureText(error), retryAfter: failure.retryAfter.toISOString() };
      // The first failure of a series is an error; later background retries only debug lines.
      if (failure.first) logger.error(log, 'CRL signing failed; the CRL stays pending');
      else if (!options.passive) logger.warn(log, 'CRL signing failed again; the CRL stays pending');
      else logger.debug(log, 'CRL signing failed again; the CRL stays pending');
      if (!options.passive || failure.first) {
        await createAuditLog({
          db,
          operation: 'crl.generate',
          entityType: 'crl',
          entityId: crlId,
          status: 'failure',
          details: { error: failureText(error), caId: ca.id, trigger: options.trigger, reason, retryAfter: failure.retryAfter.toISOString() },
          ipAddress: ctx.ipAddress ?? undefined,
        });
      }
      return { status: 'pending', need: snapshot.need, crl: snapshot.served, error, retryAfter: failure.retryAfter };
    }

    const row = {
      id: crlId,
      caId: ca.id,
      crlNumber: snapshot.nextNumber,
      thisUpdate,
      nextUpdate,
      crlPem: signed.pem,
      revokedCount: snapshot.entries.length,
      entriesSha256: crlEntriesSha256(snapshot.entries),
      createdAt: new Date(),
    };
    if (!this.commit(db, ca.id, lease, row, snapshot.generation)) {
      logger.warn({ caId: ca.id, crlNumber: row.crlNumber }, 'CRL publication lost its lease or its number; the signed CRL is dropped');
      return 'lost';
    }

    await createAuditLog({
      db,
      operation: 'crl.generate',
      entityType: 'crl',
      entityId: crlId,
      status: 'success',
      details: {
        caId: ca.id,
        crlNumber: row.crlNumber,
        revokedCount: row.revokedCount,
        thisUpdate: thisUpdate.toISOString(),
        nextUpdate: nextUpdate.toISOString(),
        signatureAlgorithm: signed.signatureAlgorithm,
        trigger: options.trigger,
        reason,
        entriesSha256: row.entriesSha256,
      },
      ipAddress: ctx.ipAddress ?? undefined,
    });
    logger.info(
      { crlId, caId: ca.id, crlNumber: row.crlNumber, revokedCount: row.revokedCount, trigger: options.trigger, reason },
      'CRL published'
    );
    return { status: 'published', need: snapshot.need, crl: row };
  }

  /** Builds the CRL and signs it in the key store: the CA private key never leaves OpenBao. */
  private async sign(
    ca: CertificateAuthority,
    crlNumber: number,
    entries: Entry[],
    thisUpdate: Date,
    nextUpdate: Date,
  ): Promise<{ pem: string; signatureAlgorithm: SignatureAlgorithm }> {
    const kmsService = getKMSService();
    const caCertificatePem = await kmsService.getCertificate(ca.kmsCertificateId, ca.id);
    // The CRL issuer is the subject of the CA certificate.
    const caCertInfo = parseCertificate(caCertificatePem, 'PEM');
    // Older CA rows may store the certificate id as kmsKeyId; resolve the real key id from
    // the certificate's private key link in that case.
    let caKeyId = ca.kmsKeyId;
    if (!caKeyId || caKeyId === ca.kmsCertificateId) {
      caKeyId = await kmsService.getCertificatePrivateKeyId(ca.kmsCertificateId, ca.id);
    }
    const signatureAlgorithm = resolveSignatureAlgorithm(ca.keyAlgorithm, caCertificatePem);
    // generateCRLWithSigner reports a signer failure as a new Error: keep the key store error
    // itself, so that the API edges can map it (cause chain of CRLOperationError).
    let signerError: unknown;
    try {
      const generated = await generateCRLWithSigner({
        issuer: caCertInfo.subject,
        crlNumber,
        thisUpdate,
        nextUpdate,
        revokedCertificates: entries.map((e) => ({ serialNumber: e.serial, revocationDate: e.date, reason: e.reason })),
        signatureAlgorithm,
        issuerCertificate: caCertificatePem,
        signer: async (tbs, hash) => {
          try {
            return await kmsService.signData(caKeyId, tbs, hash, ca.id);
          } catch (error) {
            signerError = error;
            throw error;
          }
        },
      });
      return { pem: generated.pem, signatureAlgorithm };
    } catch (error) {
      throw signerError ?? error;
    }
  }

  /** The newest row of a CA: highest number, then newest, then id (old rows can share a number). */
  private newestRow(db: Database, caId: string): Crl | null {
    return (
      db
        .select()
        .from(crls)
        .where(eq(crls.caId, caId))
        .orderBy(desc(crls.crlNumber), desc(crls.createdAt), desc(crls.id))
        .limit(1)
        .get() ?? null
    );
  }

  /** The publication row of a CA; created on first use with the highest stored number. */
  private state(db: Database, caId: string): CrlPublication {
    const existing = db.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get();
    if (existing) return existing;
    db.insert(crlPublication)
      .values({
        caId,
        lastNumber: sql`coalesce((select max(${crls.crlNumber}) from ${crls} where ${crls.caId} = ${caId}), 0)`,
      })
      .onConflictDoNothing()
      .run();
    return db.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get()!;
  }

  private highestNumber(db: Database, caId: string): number {
    const row = db
      .select({ n: sql<number | null>`max(${crls.crlNumber})` })
      .from(crls)
      .where(eq(crls.caId, caId))
      .get();
    return row?.n ?? 0;
  }

  /** What the next CRL lists, and whether the newest CRL is current. Database reads only. */
  private snapshot(db: Database, caId: string, now: Date): Snapshot {
    // The generation first: a write after this read adds 1 to it, so a verification recorded
    // with this generation can never cover a write that the reads below did not see.
    const state = this.state(db, caId);
    const generation = state.changeGeneration;
    const served = this.newestRow(db, caId);

    // Entries to carry forward: every signed row of the highest signed number. Rows from before
    // migration 0018 can share that number; each one was published, so all of them count.
    const topSigned = db
      .select({ n: sql<number | null>`max(${crls.crlNumber})` })
      .from(crls)
      .where(and(eq(crls.caId, caId), ne(crls.crlPem, '')))
      .get()?.n;
    const sources =
      topSigned === null || topSigned === undefined
        ? []
        : db
            .select({ id: crls.id, crlPem: crls.crlPem })
            .from(crls)
            .where(and(eq(crls.caId, caId), eq(crls.crlNumber, topSigned), ne(crls.crlPem, '')))
            .all();
    const carried = new Map<string, Entry>();
    for (const row of sources) {
      for (const entry of entriesOf(row) ?? []) if (!carried.has(entry.serial)) carried.set(entry.serial, entry);
    }

    const wanted = new Map(carried);
    // Revocations of deleted certificates. A CRL that lists the serial keeps its date and reason.
    for (const gone of db
      .select({
        serial: crlDeletedRevocations.serialNumber,
        revocationDate: crlDeletedRevocations.revocationDate,
        revocationReason: crlDeletedRevocations.revocationReason,
      })
      .from(crlDeletedRevocations)
      .where(eq(crlDeletedRevocations.caId, caId))
      .all()) {
      const serial = normalizeSerialHex(gone.serial);
      if (!wanted.has(serial)) {
        wanted.set(serial, { serial, date: wholeSeconds(gone.revocationDate), reason: mapRevocationReason(gone.revocationReason) });
      }
    }
    for (const removal of db
      .select({ serial: crlEntryRemovals.serialNumber })
      .from(crlEntryRemovals)
      .where(eq(crlEntryRemovals.caId, caId))
      .all()) {
      wanted.delete(removal.serial);
    }
    const revoked = db
      .select({
        serialNumber: certificates.serialNumber,
        revocationDate: certificates.revocationDate,
        revocationReason: certificates.revocationReason,
      })
      .from(certificates)
      .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked')))
      .all();
    for (const cert of revoked) {
      const serial = normalizeSerialHex(cert.serialNumber);
      wanted.set(serial, {
        serial,
        // A row with no date keeps the date that the CRL already publishes.
        date: wholeSeconds(cert.revocationDate ?? carried.get(serial)?.date ?? now),
        reason: mapRevocationReason(cert.revocationReason),
      });
    }
    const entries = [...wanted.values()].sort(bySerial);

    let need: CRLPublicationNeed | null = null;
    if (!served) need = 'missing';
    else if (!served.crlPem) need = 'empty';
    else if (now > served.nextUpdate) need = 'expired';
    else {
      // Rows from 0018 on carry the digest of their entries: no parse of the served CRL.
      if (served.entriesSha256) {
        if (served.entriesSha256 !== crlEntriesSha256(entries)) need = 'entries';
      } else {
        const servedEntries = entriesOf(served);
        if (!servedEntries || canonical(servedEntries) !== canonical(entries)) need = 'entries';
      }
    }
    const nextNumber = Math.max(state.lastNumber, this.highestNumber(db, caId)) + 1;
    return { state, generation, served, need, entries, nextNumber };
  }

  /**
   * The newest CRL row when it was verified current at the current generation and is not
   * expired; else null. Two indexed reads (publication row, newest CRL row), no certificate.
   */
  private verifiedRow(db: Database, caId: string, now: Date): Crl | null {
    const state = this.state(db, caId);
    if (state.verifiedGeneration === null || state.verifiedGeneration !== state.changeGeneration || !state.verifiedCrlId) {
      return null;
    }
    const served = this.newestRow(db, caId);
    if (!served || served.id !== state.verifiedCrlId || !served.crlPem || now > served.nextUpdate) return null;
    return served;
  }

  /** Records that CRL row `crlId` lists the state of `generation` (no-op when the generation moved). */
  private markVerified(db: Database, caId: string, generation: number, crlId: string): void {
    db.update(crlPublication)
      .set({ verifiedGeneration: generation, verifiedCrlId: crlId })
      .where(and(eq(crlPublication.caId, caId), eq(crlPublication.changeGeneration, generation)))
      .run();
  }

  /** Full check of one CA, whatever its verification says: records the result. */
  private recheck(db: Database, caId: string): void {
    const snapshot = this.snapshot(db, caId, new Date());
    if (!snapshot.need && snapshot.served) {
      this.markVerified(db, caId, snapshot.generation, snapshot.served.id);
    } else {
      db.update(crlPublication).set({ verifiedGeneration: null, verifiedCrlId: null }).where(eq(crlPublication.caId, caId)).run();
    }
  }

  /**
   * Records the CRL side of a certificate delete, in the caller's transaction (the delete of the
   * row): a revoked certificate leaves its serial, date and reason in `crl_deleted_revocations`,
   * so that the next CRL lists it also when no CRL listed it before (the signing failed). With
   * `removeFromCrl`, the serial goes to `crl_entry_removals` instead: the next CRL leaves it out.
   * Not revoked: nothing to record.
   */
  static recordCertificateDelete(
    tx: Pick<Database, 'insert'>,
    cert: Pick<typeof certificates.$inferSelect, 'id' | 'caId' | 'serialNumber' | 'status' | 'revocationDate' | 'revocationReason' | 'updatedAt'>,
    removeFromCrl: boolean,
  ): void {
    if (cert.status !== 'revoked') return;
    const serialNumber = normalizeSerialHex(cert.serialNumber);
    if (removeFromCrl) {
      tx.insert(crlEntryRemovals).values({ caId: cert.caId, serialNumber, certificateId: cert.id }).onConflictDoNothing().run();
      return;
    }
    tx.insert(crlDeletedRevocations)
      .values({
        caId: cert.caId,
        serialNumber,
        // A row with no date (old data): the last change of the row is the closest known time.
        revocationDate: cert.revocationDate ?? cert.updatedAt ?? new Date(),
        revocationReason: cert.revocationReason ?? null,
        certificateId: cert.id,
      })
      .onConflictDoNothing()
      .run();
  }

  /** Takes the publication lease of a CA when it is free or expired (one short write). */
  private takeLease(db: Database, caId: string, now: Date): string | null {
    const lease = randomUUID();
    const taken = db
      .update(crlPublication)
      .set({ lease, leaseUntil: new Date(now.getTime() + CRL_LEASE_SECONDS * 1000) })
      .where(
        and(
          eq(crlPublication.caId, caId),
          or(isNull(crlPublication.lease), isNull(crlPublication.leaseUntil), lte(crlPublication.leaseUntil, now)),
        ),
      )
      .run();
    return taken.changes === 1 ? lease : null;
  }

  /** Extends a lease that this publisher still holds (no-op when it lost it). */
  private renewLease(db: Database, caId: string, lease: string): void {
    try {
      db.update(crlPublication)
        .set({ leaseUntil: new Date(Date.now() + CRL_LEASE_SECONDS * 1000) })
        .where(and(eq(crlPublication.caId, caId), eq(crlPublication.lease, lease)))
        .run();
    } catch (error) {
      // SQLITE_BUSY or a closed database: the commit checks the lease anyway.
      logger.debug({ caId, error: message(error) }, 'CRL lease renewal failed');
    }
  }

  private releaseLease(db: Database, caId: string, lease: string): void {
    db.update(crlPublication)
      .set({ lease: null, leaseUntil: null })
      .where(and(eq(crlPublication.caId, caId), eq(crlPublication.lease, lease)))
      .run();
  }

  /** Records a failed signing, sets the retry time and frees the lease. */
  private recordFailure(db: Database, caId: string, lease: string, error: unknown): { first: boolean; retryAfter: Date } {
    const now = new Date();
    return db.transaction(
      (tx) => {
        const state = tx.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get();
        const failures = (state?.failureCount ?? 0) + 1;
        const delay = Math.min(RETRY_BASE_SECONDS * 2 ** Math.min(failures - 1, 10), RETRY_MAX_SECONDS);
        const retryAfter = new Date(now.getTime() + delay * 1000);
        tx.update(crlPublication)
          .set({ failureCount: failures, lastError: failureText(error).slice(0, 500), lastFailureAt: now, retryAfter })
          .where(eq(crlPublication.caId, caId))
          .run();
        tx.update(crlPublication)
          .set({ lease: null, leaseUntil: null })
          .where(and(eq(crlPublication.caId, caId), eq(crlPublication.lease, lease)))
          .run();
        return { first: failures === 1, retryAfter };
      },
      { behavior: 'immediate' },
    );
  }

  /**
   * Inserts the signed CRL when this publisher still holds the lease and its number is still the
   * next one (one IMMEDIATE transaction, no network). Returns false when it lost either.
   */
  private commit(db: Database, caId: string, lease: string, row: Crl, generation: number): boolean {
    return db.transaction(
      (tx) => {
        const state = tx.select().from(crlPublication).where(eq(crlPublication.caId, caId)).get();
        if (!state || state.lease !== lease) return false;
        const highest =
          tx
            .select({ n: sql<number | null>`max(${crls.crlNumber})` })
            .from(crls)
            .where(eq(crls.caId, caId))
            .get()?.n ?? 0;
        if (Math.max(state.lastNumber, highest) + 1 !== row.crlNumber) return false;
        tx.insert(crls).values(row).run();
        tx.update(crlPublication)
          // The new row lists the state of `generation`. A write after the snapshot moved the
          // generation on: then the verification does not match and the next check reads again.
          .set({
            lastNumber: row.crlNumber, lease: null, leaseUntil: null, failureCount: 0, retryAfter: null, lastPublishedAt: row.createdAt,
            verifiedGeneration: generation, verifiedCrlId: row.id,
          })
          .where(eq(crlPublication.caId, caId))
          .run();
        return true;
      },
      { behavior: 'immediate' },
    );
  }

  /**
   * Get latest CRL or specific CRL by number for a CA
   */
  async getLatest(ctx: ServiceContext, params: GetCRLParams): Promise<CRLDetails | null> {
    const { caId, crlNumber } = params;

    // Verify CA exists
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CRLCANotFoundError(caId);
    }

    let crl;

    if (crlNumber !== undefined) {
      // Get specific CRL by number (rows from before migration 0018 can share a number: the newest)
      const result = await ctx.db
        .select()
        .from(crls)
        .where(and(eq(crls.caId, caId), eq(crls.crlNumber, crlNumber))!)
        .orderBy(desc(crls.createdAt), desc(crls.id))
        .limit(1);

      if (!result || result.length === 0) {
        throw new CRLNotFoundError(caId, crlNumber);
      }

      crl = result[0];
    } else {
      // Get latest CRL
      crl = this.newestRow(ctx.db, caId);
      if (!crl) {
        return null; // No CRL generated yet
      }
    }

    // Compute validity status
    const now = new Date();
    const validityStatus: 'valid' | 'expired' = now > crl.nextUpdate ? 'expired' : 'valid';

    // Get revoked certificates for this CA (for the list)
    const revokedCerts = await ctx.db
      .select({
        serialNumber: certificates.serialNumber,
        revocationDate: certificates.revocationDate,
        revocationReason: certificates.revocationReason,
      })
      .from(certificates)
      .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked'))!);

    return {
      id: crl.id,
      caId: crl.caId,
      crlNumber: crl.crlNumber,
      thisUpdate: crl.thisUpdate.toISOString(),
      nextUpdate: crl.nextUpdate.toISOString(),
      validityStatus,
      revokedCount: crl.revokedCount,
      crlPem: crl.crlPem || null,
      // DER as base64: strip the PEM armor (the body is already base64-encoded DER).
      crlDer: crl.crlPem
        ? crl.crlPem
            .replace(/-----BEGIN X509 CRL-----/g, '')
            .replace(/-----END X509 CRL-----/g, '')
            .replace(/\s/g, '')
        : null,
      revokedCertificates: revokedCerts.map((cert) => ({
        serialNumber: cert.serialNumber,
        revocationDate: cert.revocationDate?.toISOString() || null,
        revocationReason: cert.revocationReason || null,
      })),
      createdAt: crl.createdAt.toISOString(),
    };
  }

  /**
   * List CRLs for a CA with pagination
   */
  async list(ctx: ServiceContext, params: ListCRLsParams): Promise<ListCRLsResult> {
    const { caId, limit = 50, offset = 0 } = params;

    // Verify CA exists
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CRLCANotFoundError(caId);
    }

    // Get CRLs for this CA with pagination (most recent first; stable order for shared numbers)
    const crlList = await ctx.db
      .select()
      .from(crls)
      .where(eq(crls.caId, caId))
      .orderBy(desc(crls.crlNumber), desc(crls.createdAt), desc(crls.id))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await ctx.db
      .select({ count: sql`count(*)` })
      .from(crls)
      .where(eq(crls.caId, caId));
    const totalCount = Number(countResult[0]?.count || 0);

    const now = new Date();

    const formattedCrls = crlList.map((crl) => {
      const validityStatus: 'valid' | 'expired' = now > crl.nextUpdate ? 'expired' : 'valid';

      return {
        id: crl.id,
        crlNumber: crl.crlNumber,
        thisUpdate: crl.thisUpdate.toISOString(),
        nextUpdate: crl.nextUpdate.toISOString(),
        validityStatus,
        revokedCount: crl.revokedCount,
        createdAt: crl.createdAt.toISOString(),
      };
    });

    return {
      items: formattedCrls,
      totalCount,
      limit,
      offset,
    };
  }
}

const QUEUE_TIMEOUT = Symbol('queue-timeout');

// Custom Error Classes
export class CRLCANotFoundError extends Error {
  constructor(public caId: string) {
    super(`CA with ID ${caId} not found`);
    this.name = 'CRLCANotFoundError';
  }
}

export class CRLNotFoundError extends Error {
  constructor(public caId: string, public crlNumber: number) {
    super(`CRL number ${crlNumber} not found for CA ${caId}`);
    this.name = 'CRLNotFoundError';
  }
}

export class CRLInvalidCAStatusError extends Error {
  constructor(public caId: string, public status: string) {
    super(`Cannot generate CRL for CA with status: ${status}`);
    this.name = 'CRLInvalidCAStatusError';
  }
}

export class CRLOperationError extends Error {
  constructor(public operation: string, public cause: unknown) {
    super(`Failed to ${operation} CRL: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CRLOperationError';
  }
}

/** Another publication kept the CRL slot of the CA longer than the wait (retry the request). */
export class CRLPublicationBusyError extends CRLOperationError {
  constructor(public caId: string, public retryAfterSeconds: number = 5) {
    super('generate', new Error(`another CRL publication for CA ${caId} is in progress`));
    this.name = 'CRLPublicationBusyError';
  }
}

// Singleton instance
let crlServiceInstance: CRLService | null = null;

export function getCRLService(): CRLService {
  if (!crlServiceInstance) {
    crlServiceInstance = new CRLService();
  }
  return crlServiceInstance;
}
