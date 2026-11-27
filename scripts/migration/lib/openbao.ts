/**
 * OpenBao client for the migration identity (TARGET side).
 *
 * Calls: sys/health, auth/token/lookup-self, sys/internal/ui/mounts/<mount>,
 * <mount>/wrapping_key, <mount>/keys/<name> (read), <mount>/keys/<name>/import,
 * <mount>/sign/<name> (challenge), <mount>/session-key/pkcs1v15/<name> (RA check,
 * fork only, optional), sys/storage/raft/snapshot (backup), and the backup pair
 * marker on the KV v1 mount pki-manager-backup (backup writes it, verify --restore
 * reads it; operator token only, lib/backup.ts).
 *
 * Rules: HTTPS only, CA pinned with a file, no redirects, the token is read from
 * a file and never logged, a root token is refused.
 */
import { request as httpsRequest, Agent } from 'node:https';
import { readFileSync, createWriteStream, existsSync, renameSync, rmSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { MigrationError } from './util.ts';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,126}[A-Za-z0-9]$/;
const MOUNT = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,3}$/;

export class OpenBaoHttpError extends MigrationError {
  readonly status: number;
  constructor(status: number, path: string, detail: string) {
    super(status === 0 ? 'OPENBAO_UNREACHABLE' : 'OPENBAO_ERROR', `OpenBao ${path} failed (${status === 0 ? 'transport' : `HTTP ${status}`}): ${detail.slice(0, 200)}`);
    this.status = status;
  }
}

export interface TransitKey {
  type: string;
  latestVersion: number;
  exportable: boolean;
  allowPlaintextBackup: boolean;
  importedKey: boolean;
  deletionAllowed: boolean;
  allowPkcs1v15SessionKey: boolean;
  publicKeyPem: string | null; // of version 1
  /** Public key PEM of every version OpenBao returns (`keys.<n>.public_key`), by version. */
  publicKeys: Record<number, string>;
  /** The raw `data` of the read response: the per-purpose runtime policy is checked on it (key-policy.ts). */
  data: Record<string, unknown>;
}

export interface TargetStore {
  health(): Promise<{ initialized: boolean; sealed: boolean; version: string }>;
  tokenInfo(): Promise<{ policies: string[]; accessor: string; displayName: string }>;
  mountType(mount: string): Promise<string | null>;
  wrappingKeyPem(mount: string): Promise<string>;
  readKey(mount: string, name: string): Promise<TransitKey | null>;
  importKey(mount: string, name: string, body: Json): Promise<void>;
  /** `version` is the pinned key version (default 1); the signature must come from it. */
  sign(mount: string, name: string, input: Buffer, opts: { hash: 'sha2-256' | 'sha2-384'; rsa: boolean; version?: number }): Promise<Buffer>;
  sessionKey(mount: string, name: string, ciphertext: Buffer, length: 16 | 24 | 32, version?: number): Promise<Buffer>;
  raftSnapshot(destPath: string): Promise<void>;
  /** KV v1 read: the string fields of `<mount>/<path>`, or null when there is no entry. */
  kvRead(mount: string, path: string): Promise<Record<string, string> | null>;
  /** KV v1 write (replaces the entry). */
  kvWrite(mount: string, path: string, data: Record<string, string>): Promise<void>;
}

export interface OpenBaoOptions {
  addr: string;
  caFile?: string;
  tokenFile: string;
  namespace?: string;
  timeoutMs?: number;
}

export class OpenBaoClient implements TargetStore {
  private readonly addr: URL;
  private readonly agent: Agent;
  private readonly tokenFile: string;
  private readonly namespace?: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenBaoOptions) {
    let addr: URL;
    try { addr = new URL(opts.addr); } catch { throw new MigrationError('OPENBAO_ADDR', 'OpenBao address is not a URL'); }
    if (addr.protocol !== 'https:') throw new MigrationError('OPENBAO_ADDR', 'OpenBao address must use https');
    if (addr.username || addr.password || addr.search || addr.hash || (addr.pathname !== '/' && addr.pathname !== '')) throw new MigrationError('OPENBAO_ADDR', 'OpenBao address must be scheme://host[:port]');
    this.addr = addr;
    let ca: string | undefined;
    if (opts.caFile) {
      try { ca = readFileSync(opts.caFile, 'utf8'); } catch { throw new MigrationError('OPENBAO_CACERT', 'OpenBao CA file is not readable'); }
    }
    this.agent = new Agent({ keepAlive: true, maxSockets: 4, ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    this.tokenFile = opts.tokenFile;
    this.namespace = opts.namespace;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private token(): string {
    let token: string;
    try { token = readFileSync(this.tokenFile, 'utf8').trim(); } catch { throw new MigrationError('OPENBAO_TOKEN', 'OpenBao token file is not readable'); }
    if (!/^[A-Za-z0-9._-]{8,512}$/.test(token)) throw new MigrationError('OPENBAO_TOKEN', 'OpenBao token file does not hold a token');
    return token;
  }

  private raw(method: 'GET' | 'POST' | 'LIST', path: string, body?: Json, sink?: () => NodeJS.WritableStream): Promise<{ status: number; data: Buffer }> {
    const headers: Record<string, string> = { 'X-Vault-Token': this.token(), 'X-Vault-Request': 'true' };
    if (this.namespace) headers['X-Vault-Namespace'] = this.namespace;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
    const url = new URL(`/v1/${path}`, this.addr);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method, headers, agent: this.agent, timeout: this.timeoutMs }, res => {
        const status = res.statusCode ?? 0;
        if (sink && status === 200) {
          // The sink is opened only after a 200, so a refused request leaves no file.
          const out = sink();
          out.on('error', e => reject(new OpenBaoHttpError(status, path, String(e))));
          res.pipe(out);
          out.on('finish', () => resolve({ status, data: Buffer.alloc(0) }));
          res.on('error', e => reject(new OpenBaoHttpError(status, path, String(e))));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status, data: Buffer.concat(chunks) }));
        res.on('error', e => reject(new OpenBaoHttpError(status, path, String(e))));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', e => reject(new OpenBaoHttpError(0, path, e.message)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async call(method: 'GET' | 'POST' | 'LIST', path: string, body?: Json, okStatuses: number[] = []): Promise<{ status: number; json: Json }> {
    const { status, data } = await this.raw(method, path, body);
    let json: Json = {};
    if (data.length) { try { const p: unknown = JSON.parse(data.toString('utf8')); if (isObject(p)) json = p; } catch { /* not JSON */ } }
    if ((status >= 200 && status < 300) || okStatuses.includes(status)) return { status, json };
    const errors = Array.isArray(json.errors) ? json.errors.filter(e => typeof e === 'string').join('; ') : '';
    throw new OpenBaoHttpError(status, path, errors);
  }

  async health() {
    // sys/health answers 503 when sealed, 501 when not initialized: both are data here.
    const { json } = await this.call('GET', 'sys/health', undefined, [429, 472, 473, 501, 503]);
    return { initialized: json.initialized === true, sealed: json.sealed !== false, version: String(json.version ?? '') };
  }

  async tokenInfo() {
    const { json } = await this.call('GET', 'auth/token/lookup-self');
    const d = isObject(json.data) ? json.data : {};
    const policies = Array.isArray(d.policies) ? d.policies.map(String) : [];
    return { policies, accessor: String(d.accessor ?? ''), displayName: String(d.display_name ?? '') };
  }

  async mountType(mount: string) {
    if (!MOUNT.test(mount)) throw new MigrationError('OPENBAO_MOUNT', `invalid mount ${mount}`);
    try {
      const { json } = await this.call('GET', `sys/internal/ui/mounts/${mount}`);
      const d = isObject(json.data) ? json.data : {};
      return typeof d.type === 'string' ? d.type : null;
    } catch (error) {
      if (error instanceof OpenBaoHttpError && (error.status === 403 || error.status === 404)) return null;
      throw error;
    }
  }

  async wrappingKeyPem(mount: string) {
    const { json } = await this.call('GET', `${mount}/wrapping_key`);
    const pem = isObject(json.data) ? json.data.public_key : undefined;
    if (typeof pem !== 'string') throw new MigrationError('OPENBAO_WRAPPING_KEY', `no wrapping key on ${mount}`);
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 4096) throw new MigrationError('OPENBAO_WRAPPING_KEY', 'wrapping key is not RSA-4096');
    return pem;
  }

  async readKey(mount: string, name: string): Promise<TransitKey | null> {
    if (!NAME.test(name)) throw new MigrationError('TARGET_NAME', `invalid target key name ${name}`);
    let json: Json;
    try {
      ({ json } = await this.call('GET', `${mount}/keys/${name}`));
    } catch (error) {
      if (error instanceof OpenBaoHttpError && error.status === 404) return null;
      throw error;
    }
    const d = isObject(json.data) ? json.data : {};
    const keys = isObject(d.keys) ? d.keys : {};
    const v1 = isObject(keys['1']) ? keys['1'] : undefined;
    return {
      type: String(d.type ?? ''),
      latestVersion: Number(d.latest_version ?? 0),
      exportable: d.exportable === true,
      allowPlaintextBackup: d.allow_plaintext_backup === true,
      importedKey: d.imported_key === true,
      deletionAllowed: d.deletion_allowed === true,
      allowPkcs1v15SessionKey: d.allow_pkcs1v15_session_key === true,
      publicKeyPem: v1 && typeof v1.public_key === 'string' ? v1.public_key : null,
      publicKeys: Object.fromEntries(Object.entries(keys).flatMap(([v, k]) => (isObject(k) && typeof k.public_key === 'string' && /^[1-9][0-9]*$/.test(v) ? [[Number(v), k.public_key]] : []))),
      data: d,
    };
  }

  async importKey(mount: string, name: string, body: Json) {
    if (!NAME.test(name)) throw new MigrationError('TARGET_NAME', `invalid target key name ${name}`);
    await this.call('POST', `${mount}/keys/${name}/import`, body);
  }

  async sign(mount: string, name: string, input: Buffer, opts: { hash: 'sha2-256' | 'sha2-384'; rsa: boolean; version?: number }) {
    const version = opts.version ?? 1;
    if (!Number.isInteger(version) || version < 1) throw new MigrationError('OPENBAO_SIGN', `invalid key version ${version}`);
    const body: Json = { input: input.toString('base64'), key_version: version, marshaling_algorithm: 'asn1' };
    if (opts.rsa) body.signature_algorithm = 'pkcs1v15';
    const { json } = await this.call('POST', `${mount}/sign/${name}/${opts.hash}`, body);
    const sig = isObject(json.data) ? json.data.signature : undefined;
    const prefix = `vault:v${version}:`;
    if (typeof sig !== 'string' || !sig.startsWith(prefix)) throw new MigrationError('OPENBAO_SIGN', `signature missing or not from key version ${version}`);
    return Buffer.from(sig.slice(prefix.length), 'base64');
  }

  async sessionKey(mount: string, name: string, ciphertext: Buffer, length: 16 | 24 | 32, version = 1) {
    if (!Number.isInteger(version) || version < 1) throw new MigrationError('OPENBAO_SESSION_KEY', `invalid key version ${version}`);
    const { json } = await this.call('POST', `${mount}/session-key/pkcs1v15/${name}`, { ciphertext: ciphertext.toString('base64'), key_version: version, session_key_length: length });
    const key = isObject(json.data) ? json.data.session_key : undefined;
    if (typeof key !== 'string') throw new MigrationError('OPENBAO_SESSION_KEY', 'no session key returned');
    if (!isObject(json.data) || json.data.key_version !== version) throw new MigrationError('OPENBAO_SESSION_KEY', 'session key has the wrong key version');
    return Buffer.from(key, 'base64');
  }

  async raftSnapshot(destPath: string) {
    if (existsSync(destPath)) throw new MigrationError('BACKUP_EXISTS', `refusing to overwrite ${destPath}`);
    const partial = `${destPath}.partial`;
    try {
      const { status, data } = await this.raw('GET', 'sys/storage/raft/snapshot', undefined, () => createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
      if (status !== 200) {
        let detail = data.toString('utf8');
        try { const j = JSON.parse(detail) as { errors?: unknown }; if (Array.isArray(j.errors)) detail = j.errors.join('; '); } catch { /* not JSON */ }
        throw new OpenBaoHttpError(status, 'sys/storage/raft/snapshot', `${detail}${status === 403 ? ' (use an operator token with read on sys/storage/raft/snapshot)' : ''}`);
      }
      renameSync(partial, destPath);
    } finally {
      rmSync(partial, { force: true });
    }
  }

  async kvRead(mount: string, path: string) {
    if (!MOUNT.test(mount) || !MOUNT.test(path)) throw new MigrationError('OPENBAO_KV', `invalid KV path ${mount}/${path}`);
    let json: Json;
    try {
      ({ json } = await this.call('GET', `${mount}/${path}`));
    } catch (error) {
      if (error instanceof OpenBaoHttpError && error.status === 404) return null;
      throw error;
    }
    const d = isObject(json.data) ? json.data : {};
    return Object.fromEntries(Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
  }

  async kvWrite(mount: string, path: string, data: Record<string, string>) {
    if (!MOUNT.test(mount) || !MOUNT.test(path)) throw new MigrationError('OPENBAO_KV', `invalid KV path ${mount}/${path}`);
    await this.call('POST', `${mount}/${path}`, data);
  }

}
