/**
 * Shared OpenBao HTTPS transport for the backend Transit clients (decision-018).
 *
 * The SCEP RA client (`ra-transit.ts`) and the SSH CA client (`ssh-transit.ts`)
 * use the same connection settings and the same request rules:
 *
 * - HTTPS only. `OPENBAO_CACERT` pins the trust anchors; no redirects are followed.
 * - The token comes from a file read on every call, so an OpenBao Agent (or an
 *   operator) can rotate it without a restart. It never goes in a log. The SSH client
 *   uses `OPENBAO_TOKEN_FILE` (the X.509/SSH credential); the RA client uses
 *   `OPENBAO_RA_TOKEN_FILE`, a separate credential that only holds the RA mount.
 * - Each client has its own Transit mount (`OPENBAO_RA_MOUNT`, `OPENBAO_SSH_MOUNT`).
 * - Errors carry the HTTP status and the request path only. The OpenBao error
 *   text stays in `detail` for the server log; it never reaches an API client.
 */
import { request as httpsRequest, Agent } from 'node:https';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { X509Certificate } from 'node:crypto';

export const PATH_SEGMENTS = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,3}$/;
const TOKEN = /^[A-Za-z0-9._-]{8,512}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class OpenBaoConfigError extends Error {}

export class OpenBaoError extends Error {
  /** OpenBao error text, for the server log only. */
  readonly detail: string;
  constructor(readonly status: number, readonly path: string, detail: string) {
    super(`OpenBao request failed (${status === 0 ? 'transport' : `HTTP ${status}`}) on ${path}`);
    this.detail = detail.slice(0, 500);
  }
}

/** A response that does not match what the caller requires. */
export class OpenBaoResponseError extends Error {}

/** Connection settings shared by every Transit client. */
export interface OpenBaoConnection {
  addr: URL;
  caPem?: string;
  tokenFile: string;
  namespace?: string;
  timeoutMs: number;
}

/** `tokenVariable` names the token file setting of the credential that this client uses. */
export function loadOpenBaoConnection(env: NodeJS.ProcessEnv = process.env, tokenVariable = 'OPENBAO_TOKEN_FILE'): OpenBaoConnection {
  const rawAddr = env.OPENBAO_ADDR?.trim();
  if (!rawAddr) throw new OpenBaoConfigError('OPENBAO_ADDR is required');
  let addr: URL;
  try { addr = new URL(rawAddr); } catch { throw new OpenBaoConfigError('OPENBAO_ADDR is not a URL'); }
  if (addr.protocol !== 'https:') throw new OpenBaoConfigError('OPENBAO_ADDR must use https');
  if (addr.username || addr.password || addr.search || addr.hash || (addr.pathname !== '/' && addr.pathname !== '')) {
    throw new OpenBaoConfigError('OPENBAO_ADDR must be scheme://host[:port] only');
  }
  let caPem: string | undefined;
  const caFile = env.OPENBAO_CACERT?.trim();
  if (caFile) {
    try {
      caPem = readFileSync(caFile, 'utf8');
      new X509Certificate(caPem); // at least the first certificate must parse
    } catch { throw new OpenBaoConfigError('OPENBAO_CACERT must be a readable PEM certificate file'); }
  }
  const tokenFile = env[tokenVariable]?.trim();
  if (!tokenFile || !isAbsolute(tokenFile)) throw new OpenBaoConfigError(`${tokenVariable} must be an absolute path`);
  const namespace = env.OPENBAO_NAMESPACE?.trim() || undefined;
  if (namespace && !PATH_SEGMENTS.test(namespace)) throw new OpenBaoConfigError('OPENBAO_NAMESPACE is not a valid namespace path');
  const timeoutMs = env.OPENBAO_TIMEOUT_MS ? Number(env.OPENBAO_TIMEOUT_MS) : 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new OpenBaoConfigError('OPENBAO_TIMEOUT_MS must be 1000-60000');
  return { addr, caPem, tokenFile, namespace, timeoutMs };
}

/** Reads one Transit mount setting (for example `OPENBAO_SSH_MOUNT`). */
export function loadMount(env: NodeJS.ProcessEnv, variable: string, fallback: string): string {
  const mount = (env[variable] ?? fallback).trim();
  if (!PATH_SEGMENTS.test(mount)) throw new OpenBaoConfigError(`${variable} is not a valid mount path`);
  return mount;
}

/** Standard base64 that round-trips exactly (no whitespace, no URL alphabet, canonical padding). */
export function strictBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new OpenBaoResponseError('invalid base64 field');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new OpenBaoResponseError('non-canonical base64 field');
  return bytes;
}

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One HTTPS connection pool to OpenBao, for one Transit mount. */
export class OpenBaoHttp {
  private readonly agent: Agent;
  constructor(private readonly conn: OpenBaoConnection, readonly mount: string) {
    this.agent = new Agent({ keepAlive: true, maxSockets: 8, ca: conn.caPem, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  }

  private token(): string {
    let token: string;
    try { token = readFileSync(this.conn.tokenFile, 'utf8').trim(); } catch { throw new OpenBaoError(0, 'token', 'token file unreadable'); }
    if (!TOKEN.test(token)) throw new OpenBaoError(0, 'token', 'token file content is not a token');
    return token;
  }

  /** `path` is relative to the mount. Resolves only on 2xx. */
  call(method: 'GET' | 'POST', path: string, body?: Json): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'X-Vault-Token': this.token(), 'X-Vault-Request': 'true', accept: 'application/json' };
    if (this.conn.namespace) headers['X-Vault-Namespace'] = this.conn.namespace;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
    const url = new URL(`/v1/${this.mount}/${path}`, this.conn.addr);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method, headers, agent: this.agent, timeout: this.conn.timeoutMs }, res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { req.destroy(); reject(new OpenBaoError(res.statusCode ?? 0, path, 'response too large')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          let json: Json = {};
          const text = Buffer.concat(chunks).toString('utf8');
          if (text) {
            try { const parsed: unknown = JSON.parse(text); if (isObject(parsed)) json = parsed; } catch { /* not JSON */ }
          }
          if (status >= 200 && status < 300) { resolve({ status, json }); return; }
          const errors = Array.isArray(json.errors) ? json.errors.filter(e => typeof e === 'string').join('; ') : '';
          reject(new OpenBaoError(status, path, errors));
        });
        res.on('error', error => reject(new OpenBaoError(res.statusCode ?? 0, path, String(error))));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', error => reject(error instanceof OpenBaoError ? error : new OpenBaoError(0, path, error.message)));
      if (payload) req.write(payload);
      req.end();
    });
  }
}
