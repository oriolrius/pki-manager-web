/**
 * OpenBao Transit client for the SSH CA keys (decision-018 cutover).
 *
 * Every SSH CA key lives in one Transit mount (`OPENBAO_SSH_MOUNT`, default
 * `pki-manager-ssh`), against the PKI Manager OpenBao fork. Three calls only:
 *
 *   GET  <mount>/keys/<name>             read and check the key policy
 *   POST <mount>/keys/<name>             create the key (new CA or rotation successor)
 *   POST <mount>/sign/<name>/sha2-256    ECDSA P-256 / SHA-256 over the message, DER
 *
 * Key reference (stored in `ssh_cas.kms_key_id` and `ssh_cas.kms_public_key_id`):
 *
 *   openbao-transit:<mount>:<name>:<version>
 *
 * The mount, name and version are fixed for the life of the CA. The backend
 * never rotates a Transit key: an SSH CA rotation creates a new key (a new CA).
 * Any other value in those columns is a legacy Cosmian KMS id; the CA then needs
 * the key migration before it can sign (`SshCaKeyMigrationRequiredError`).
 *
 * Rules (the transport rules are in `http.ts`):
 * - The key must be `ecdsa-p256`, non-exportable, without plaintext backup, not
 *   derived, not deletable, and must still have the pinned version.
 * - A key that the backend creates must be a generated key. An imported key (a
 *   migrated Cosmian CA key) is accepted when its public key equals the public
 *   key recorded for the CA, which every signature is checked against too.
 * - Every signature is verified locally before it leaves this module.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  OpenBaoConfigError, OpenBaoError, OpenBaoHttp, OpenBaoResponseError, isObject, loadMount, loadOpenBaoConnection, strictBase64,
  PATH_SEGMENTS, type OpenBaoConnection,
} from './http.js';

export { OpenBaoConfigError, OpenBaoError, OpenBaoResponseError };

export const SSH_KEY_REF_PREFIX = 'openbao-transit:';
/** Names the backend creates (`ssh-ca-<ca uuid>`) or a migration writes (`ssh-ca-<anything safe>`). */
const KEY_NAME = /^ssh-ca-[A-Za-z0-9_-]{1,100}$/;
const VERSION = /^[1-9][0-9]{0,8}$/;

export interface SshCaKeyRef { mount: string; name: string; version: number }

export interface OpenBaoSshConfig extends OpenBaoConnection { mount: string }

export function loadOpenBaoSshConfig(env: NodeJS.ProcessEnv = process.env): OpenBaoSshConfig {
  return { ...loadOpenBaoConnection(env), mount: loadMount(env, 'OPENBAO_SSH_MOUNT', 'pki-manager-ssh') };
}

/** True when the stored key id is an OpenBao reference (any other value is a legacy Cosmian id). */
export function isOpenBaoSshKeyRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SSH_KEY_REF_PREFIX);
}

export function formatSshKeyRef(ref: SshCaKeyRef): string {
  if (!PATH_SEGMENTS.test(ref.mount) || !KEY_NAME.test(ref.name) || !VERSION.test(String(ref.version))) {
    throw new OpenBaoResponseError('invalid SSH CA key reference');
  }
  return `${SSH_KEY_REF_PREFIX}${ref.mount}:${ref.name}:${ref.version}`;
}

/** Strict parse; throws `OpenBaoResponseError` on anything but a well-formed reference. */
export function parseSshKeyRef(value: string): SshCaKeyRef {
  if (!isOpenBaoSshKeyRef(value)) throw new OpenBaoResponseError('not an OpenBao SSH CA key reference');
  const parts = value.slice(SSH_KEY_REF_PREFIX.length).split(':');
  if (parts.length !== 3) throw new OpenBaoResponseError('invalid SSH CA key reference');
  const [mount, name, version] = parts;
  if (!PATH_SEGMENTS.test(mount) || !KEY_NAME.test(name) || !VERSION.test(version)) throw new OpenBaoResponseError('invalid SSH CA key reference');
  return { mount, name, version: Number(version) };
}

/**
 * Checks a Transit key read response for the SSH CA requirements and returns
 * the public key of `version`. Exported for tests.
 */
export function checkSshCaKeyPolicy(data: unknown, version: number, options: { allowImported?: boolean } = {}): KeyObject {
  if (!isObject(data)) throw new OpenBaoResponseError('key response has no data');
  if (data.type !== 'ecdsa-p256') throw new OpenBaoResponseError('SSH CA key must be ecdsa-p256');
  if (data.imported_key === true && !options.allowImported) throw new OpenBaoResponseError('a new SSH CA requires a generated key');
  if (data.imported_key === true && data.imported_key_allow_rotation === true) throw new OpenBaoResponseError('imported SSH CA key must not allow rotation');
  if (data.soft_deleted === true) throw new OpenBaoResponseError('SSH CA key is soft-deleted');
  if (data.exportable !== false) throw new OpenBaoResponseError('SSH CA key must not be exportable');
  if (data.allow_plaintext_backup !== false) throw new OpenBaoResponseError('SSH CA key must not allow plaintext backup');
  if (data.derived !== false) throw new OpenBaoResponseError('SSH CA key must not be derived');
  if (data.deletion_allowed !== false) throw new OpenBaoResponseError('SSH CA key must not allow deletion');
  if (data.supports_signing !== true) throw new OpenBaoResponseError('SSH CA key does not support signing');
  const latest = data.latest_version, minEncrypt = data.min_encryption_version ?? 0, minAvailable = data.min_available_version ?? 0;
  if (!Number.isInteger(latest) || !Number.isInteger(minEncrypt) || !Number.isInteger(minAvailable)) throw new OpenBaoResponseError('key versions missing');
  // Transit refuses to sign with a version below min_encryption_version.
  if ((latest as number) < version || (minEncrypt as number) > version || (minAvailable as number) > version) throw new OpenBaoResponseError('SSH CA key version is not available');
  const keys = data.keys;
  const entry = isObject(keys) ? keys[String(version)] : undefined;
  if (!isObject(entry) || typeof entry.public_key !== 'string') throw new OpenBaoResponseError('SSH CA key version has no public key');
  let key: KeyObject;
  try { key = createPublicKey(entry.public_key); } catch { throw new OpenBaoResponseError('SSH CA public key does not parse'); }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new OpenBaoResponseError('SSH CA public key is not P-256');
  return key;
}

/** ECDSA P-256 / SHA-256 verification of a DER signature over `data` (Node crypto only). */
export function verifySshCaSignature(publicKey: KeyObject, data: Buffer, der: Buffer): boolean {
  try { return verify('sha256', data, { key: publicKey, dsaEncoding: 'der' }, der); } catch { return false; }
}

const spki = (key: KeyObject) => key.export({ format: 'der', type: 'spki' });

export class OpenBaoSshTransit {
  private readonly http: OpenBaoHttp;
  constructor(private readonly cfg: OpenBaoSshConfig) {
    this.http = new OpenBaoHttp(cfg, cfg.mount);
  }

  get mount(): string { return this.cfg.mount; }

  /** A reference must point into the configured mount: a moved mount needs an explicit migration. */
  private assertMount(ref: SshCaKeyRef): void {
    if (ref.mount !== this.cfg.mount) throw new OpenBaoResponseError('SSH CA key reference is not in OPENBAO_SSH_MOUNT');
    if (!KEY_NAME.test(ref.name)) throw new OpenBaoResponseError('invalid SSH CA key name');
  }

  /** Reads and checks the key; null when it does not exist. */
  async readKey(ref: SshCaKeyRef, options: { allowImported?: boolean } = {}): Promise<KeyObject | null> {
    this.assertMount(ref);
    try {
      const { json } = await this.http.call('GET', `keys/${ref.name}`);
      return checkSshCaKeyPolicy(json.data, ref.version, options);
    } catch (error) {
      if (error instanceof OpenBaoError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Creates a new generated key `name` (version 1) and returns its reference and
   * public key. Refuses a name that already exists: a new CA never adopts a key.
   */
  async createKey(name: string): Promise<{ ref: SshCaKeyRef; publicKey: KeyObject }> {
    const ref: SshCaKeyRef = { mount: this.cfg.mount, name, version: 1 };
    this.assertMount(ref);
    try {
      await this.http.call('GET', `keys/${name}`);
      throw new OpenBaoResponseError('SSH CA key name already exists');
    } catch (error) {
      if (!(error instanceof OpenBaoError && error.status === 404)) throw error;
    }
    await this.http.call('POST', `keys/${name}`, { type: 'ecdsa-p256', exportable: false, allow_plaintext_backup: false, auto_rotate_period: 0 });
    const publicKey = await this.readKey(ref);
    if (!publicKey) throw new OpenBaoResponseError('SSH CA key not readable after creation');
    return { ref, publicKey };
  }

  /**
   * ECDSA P-256 / SHA-256 over `data` (Transit hashes it) with the pinned
   * version; returns the DER signature after checking it against `publicKey`
   * (the public key recorded for the CA).
   */
  async sign(ref: SshCaKeyRef, data: Buffer, publicKey: KeyObject): Promise<Buffer> {
    this.assertMount(ref);
    if (data.length === 0) throw new OpenBaoResponseError('nothing to sign');
    const { json } = await this.http.call('POST', `sign/${ref.name}/sha2-256`, {
      input: data.toString('base64'), key_version: ref.version, marshaling_algorithm: 'asn1',
    });
    const body = json.data;
    const signature = isObject(body) ? body.signature : undefined;
    const prefix = `vault:v${ref.version}:`;
    if (typeof signature !== 'string' || !signature.startsWith(prefix)) throw new OpenBaoResponseError('signature has the wrong key version');
    const der = strictBase64(signature.slice(prefix.length));
    if (!verifySshCaSignature(publicKey, data, der)) throw new OpenBaoResponseError('signature does not verify with the SSH CA public key');
    return der;
  }

  /** True when the two keys are the same public key. */
  static samePublicKey(a: KeyObject, b: KeyObject): boolean {
    return spki(a).equals(spki(b));
  }
}

let cached: OpenBaoSshTransit | undefined;
/** Lazily configured client; config errors are thrown on first use. */
export function getOpenBaoSshTransit(): OpenBaoSshTransit {
  cached ??= new OpenBaoSshTransit(loadOpenBaoSshConfig());
  return cached;
}
/** Tests only. */
export function resetOpenBaoSshTransit(): void { cached = undefined; }

/**
 * Startup check: when an SSH CA uses OpenBao, or `OPENBAO_ADDR` is set, the
 * OpenBao SSH settings must be valid. Without any use they are checked on the
 * first SSH CA operation.
 */
export function checkOpenBaoSshConfig(openBaoCas: number, env: NodeJS.ProcessEnv = process.env): void {
  if (openBaoCas > 0 || env.OPENBAO_ADDR) loadOpenBaoSshConfig(env);
}
