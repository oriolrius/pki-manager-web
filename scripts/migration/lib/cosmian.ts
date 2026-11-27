/**
 * Minimal KMIP 2.1 JSON client for the SOURCE Cosmian KMS (v3 installations).
 *
 * Read operations: Query, GetAttributes, Get (public keys and certificates).
 * Transfer operations (only with an approval, see policy.ts):
 *   Import + Activate of the TARGET wrapping public key (the only source write),
 *   wrapped Get of a private key under that wrapping key (CKM_RSA_AES_KEY_WRAP:
 *   RSA-OAEP-SHA256 + AES-KWP), and Revoke + Destroy of that wrapping key.
 * The private key never exists in clear in this process: Cosmian returns it
 * encrypted to the OpenBao wrapping key, and only OpenBao can unwrap it.
 * A key with Extractable=false is refused by Cosmian; the tool never retries
 * that with another method.
 */
import { MigrationError } from './util.ts';

type El = { tag: string; type?: string; value: unknown };

export interface KeyAttributes {
  id: string;
  objectType: string | null;
  state: string | null;
  algorithm: string | null;
  length: number | null;
  sensitive: boolean | null;
  extractable: boolean | null;
  alwaysSensitive: boolean | null;
  neverExtractable: boolean | null;
  links: Record<string, string>;
}

export interface CosmianSource {
  query(): Promise<void>;
  getAttributes(id: string): Promise<KeyAttributes | null>;
  getPublicKeySpki(publicKeyId: string): Promise<Buffer>;
  getCertificateDer(certificateId: string): Promise<Buffer | null>;
  registerWrappingKey(spkiDer: Buffer, label: string): Promise<string>;
  wrappedGet(privateKeyId: string, wrappingKeyId: string): Promise<Buffer>;
  removeWrappingKey(id: string): Promise<void>;
}

export class KmipError extends MigrationError {
  readonly status: number;
  constructor(status: number, op: string, detail: string) {
    // KMIP error text names object ids only, never key material.
    super(status === 0 ? 'KMS_UNREACHABLE' : 'KMS_ERROR', `Cosmian ${op} failed (${status === 0 ? 'transport' : `HTTP ${status}`}): ${detail.slice(0, 200)}`);
    this.status = status;
  }
}

const text = (tag: string, value: string): El => ({ tag, type: 'TextString', value });
const enumeration = (tag: string, value: string): El => ({ tag, type: 'Enumeration', value });

function find(elements: unknown, tag: string): El | undefined {
  return Array.isArray(elements) ? (elements as El[]).find(e => e && e.tag === tag) : undefined;
}

function deepFindBytes(el: unknown, tags: string[]): string | undefined {
  if (!el || typeof el !== 'object') return undefined;
  const e = el as El;
  if (tags.includes(e.tag) && e.type === 'ByteString' && typeof e.value === 'string') return e.value;
  if (Array.isArray(e.value)) for (const child of e.value) { const f = deepFindBytes(child, tags); if (f) return f; }
  return undefined;
}

export class CosmianKmipClient implements CosmianSource {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(url: string, opts: { apiKey?: string; timeoutMs?: number } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new MigrationError('KMS_URL', 'KMS URL must be http(s)');
    this.endpoint = `${url.replace(/\/$/, '')}/kmip/2_1`;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async call(op: string, value: El[]): Promise<El[]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    let res: Response;
    try {
      res = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify({ tag: op, value }), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch (error) {
      throw new KmipError(0, op, String((error as Error).message ?? error));
    }
    const body = await res.text();
    if (!res.ok) throw new KmipError(res.status, op, body);
    let parsed: { value?: unknown };
    try { parsed = JSON.parse(body); } catch { throw new KmipError(res.status, op, 'response is not JSON'); }
    return Array.isArray(parsed.value) ? (parsed.value as El[]) : [];
  }

  async query(): Promise<void> {
    await this.call('Query', []);
  }

  async getAttributes(id: string): Promise<KeyAttributes | null> {
    let value: El[];
    try {
      value = await this.call('GetAttributes', [text('UniqueIdentifier', id)]);
    } catch (error) {
      if (error instanceof KmipError && error.status >= 400 && error.status < 500 && /not.?found|Item_Not_Found|does not exist/i.test(error.message)) return null;
      throw error;
    }
    const attrs = find(value, 'Attributes');
    const list = Array.isArray(attrs?.value) ? (attrs.value as El[]) : [];
    const get = (tag: string) => list.find(e => e.tag === tag)?.value;
    const bool = (tag: string) => { const v = get(tag); return typeof v === 'boolean' ? v : null; };
    const links: Record<string, string> = {};
    for (const a of list) {
      if (a.tag !== 'Link' || !Array.isArray(a.value)) continue;
      const type = find(a.value, 'LinkType')?.value;
      const target = find(a.value, 'LinkedObjectIdentifier')?.value;
      if (typeof type === 'string' && typeof target === 'string') links[type] = target;
    }
    return {
      id,
      objectType: typeof get('ObjectType') === 'string' ? String(get('ObjectType')) : null,
      state: typeof get('State') === 'string' ? String(get('State')) : null,
      algorithm: typeof get('CryptographicAlgorithm') === 'string' ? String(get('CryptographicAlgorithm')) : null,
      length: typeof get('CryptographicLength') === 'number' ? Number(get('CryptographicLength')) : null,
      sensitive: bool('Sensitive'),
      extractable: bool('Extractable'),
      alwaysSensitive: bool('AlwaysSensitive'),
      neverExtractable: bool('NeverExtractable'),
      links,
    };
  }

  async getPublicKeySpki(publicKeyId: string): Promise<Buffer> {
    const value = await this.call('Get', [text('UniqueIdentifier', publicKeyId), enumeration('KeyFormatType', 'PKCS8')]);
    const hex = deepFindBytes(find(value, 'PublicKey'), ['KeyMaterial']);
    if (!hex) throw new MigrationError('KMS_NO_PUBLIC_KEY', `no SPKI for public key ${publicKeyId}`);
    return Buffer.from(hex, 'hex');
  }

  async getCertificateDer(certificateId: string): Promise<Buffer | null> {
    let value: El[];
    try {
      value = await this.call('Get', [text('UniqueIdentifier', certificateId)]);
    } catch (error) {
      if (error instanceof KmipError && error.status >= 400 && error.status < 500 && /not.?found|Item_Not_Found|does not exist/i.test(error.message)) return null;
      throw error;
    }
    const hex = deepFindBytes(find(value, 'Certificate'), ['CertificateValue']);
    return hex ? Buffer.from(hex, 'hex') : null;
  }

  async registerWrappingKey(spkiDer: Buffer, label: string): Promise<string> {
    const value = await this.call('Import', [
      text('UniqueIdentifier', ''),
      enumeration('ObjectType', 'PublicKey'),
      { tag: 'ReplaceExisting', type: 'Boolean', value: false },
      { tag: 'Attributes', value: [{ tag: 'Attribute', value: [
        text('VendorIdentification', 'cosmian'), text('AttributeName', 'tag'), text('AttributeValue', JSON.stringify(['pki-manager-migration', label])),
      ] }] },
      { tag: 'PublicKey', value: [{ tag: 'KeyBlock', value: [
        enumeration('KeyFormatType', 'PKCS8'),
        { tag: 'KeyValue', value: [{ tag: 'KeyMaterial', type: 'ByteString', value: spkiDer.toString('hex') }] },
      ] }] },
    ]);
    const id = find(value, 'UniqueIdentifier')?.value;
    if (typeof id !== 'string' || !id) throw new MigrationError('KMS_IMPORT', 'wrapping key import returned no id');
    await this.call('Activate', [text('UniqueIdentifier', id)]); // imported objects are PreActive
    return id;
  }

  async wrappedGet(privateKeyId: string, wrappingKeyId: string): Promise<Buffer> {
    const value = await this.call('Get', [
      text('UniqueIdentifier', privateKeyId),
      // No KeyFormatType: Cosmian wraps only the default format (it answers 500 otherwise).
      { tag: 'KeyWrappingSpecification', value: [
        enumeration('WrappingMethod', 'Encrypt'),
        { tag: 'EncryptionKeyInformation', value: [
          text('UniqueIdentifier', wrappingKeyId),
          { tag: 'CryptographicParameters', value: [
            enumeration('PaddingMethod', 'None'), enumeration('HashingAlgorithm', 'SHA256'), enumeration('CryptographicAlgorithm', 'RSA'),
          ] },
        ] },
        enumeration('EncodingOption', 'NoEncoding'),
      ] },
    ]);
    const wrapped = find(value, 'PrivateKey');
    // A wrapped key block carries KeyWrappingData; refuse a clear key block outright.
    if (!JSON.stringify(wrapped ?? {}).includes('KeyWrappingData')) throw new MigrationError('KMS_NOT_WRAPPED', `Cosmian returned key ${privateKeyId} without wrapping; refusing`);
    const hex = deepFindBytes(wrapped, ['KeyMaterial', 'KeyValue']);
    if (!hex) throw new MigrationError('KMS_NO_WRAPPED_BYTES', `no wrapped bytes for ${privateKeyId}`);
    return Buffer.from(hex, 'hex');
  }

  async removeWrappingKey(id: string): Promise<void> {
    try {
      await this.call('Revoke', [text('UniqueIdentifier', id), { tag: 'RevocationReason', value: [enumeration('RevocationReasonCode', 'CessationOfOperation'), text('RevocationMessage', 'migration finished')] }]);
    } catch { /* already revoked */ }
    await this.call('Destroy', [text('UniqueIdentifier', id)]);
  }
}
