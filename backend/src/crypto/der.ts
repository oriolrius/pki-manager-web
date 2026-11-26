/**
 * Minimal DER reader and writer for the X.509 structures that PKI Manager builds itself
 * (TBSCertificate, CSR parsing, CRL issuer names). It works on Buffers and keeps the raw bytes
 * of every element, so Names and SubjectPublicKeyInfo can be copied without re-encoding.
 *
 * Only definite lengths are accepted (DER). Indefinite lengths, lengths over 4 bytes and
 * elements that run past their parent are refused.
 */

export class DerError extends Error {}

export interface DerNode {
  /** The identifier octet (class, constructed bit and tag number < 31). */
  tag: number;
  /** Whole element: identifier, length and contents. */
  raw: Buffer;
  /** Contents only. */
  value: Buffer;
  /** Parsed children for constructed elements; empty for primitive ones. */
  children: DerNode[];
}

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

const MAX_DEPTH = 32;

function readNode(buf: Buffer, offset: number, end: number, depth: number): { node: DerNode; next: number } {
  if (depth > MAX_DEPTH) throw new DerError('DER nesting too deep');
  if (offset + 2 > end) throw new DerError('DER element truncated');
  const tag = buf[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError('DER high tag numbers are not supported');
  let lengthByte = buf[offset + 1];
  let pos = offset + 2;
  let length: number;
  if (lengthByte < 0x80) {
    length = lengthByte;
  } else {
    lengthByte &= 0x7f;
    if (lengthByte === 0) throw new DerError('DER indefinite length is not allowed');
    if (lengthByte > 4) throw new DerError('DER length too large');
    if (pos + lengthByte > end) throw new DerError('DER length truncated');
    length = 0;
    for (let i = 0; i < lengthByte; i++) length = length * 256 + buf[pos + i];
    if (length < 0x80 || (lengthByte > 1 && buf[pos] === 0)) throw new DerError('DER length is not minimal');
    pos += lengthByte;
  }
  const valueEnd = pos + length;
  if (valueEnd > end) throw new DerError('DER element runs past its parent');
  const value = buf.subarray(pos, valueEnd);
  const children: DerNode[] = [];
  if (tag & 0x20) {
    let childPos = pos;
    while (childPos < valueEnd) {
      const child = readNode(buf, childPos, valueEnd, depth + 1);
      children.push(child.node);
      childPos = child.next;
    }
  }
  return { node: { tag, raw: buf.subarray(offset, valueEnd), value, children }, next: valueEnd };
}

/** Parse one complete DER element; trailing bytes are an error. */
export function parseDer(input: Buffer): DerNode {
  const { node, next } = readNode(input, 0, input.length, 0);
  if (next !== input.length) throw new DerError('trailing bytes after DER element');
  return node;
}

/** Child `index` of a constructed node, with an optional tag check. */
export function child(node: DerNode, index: number, tag?: number): DerNode {
  const c = node.children[index];
  if (!c) throw new DerError(`DER element has no child ${index}`);
  if (tag !== undefined && c.tag !== tag) throw new DerError(`DER child ${index} has tag 0x${c.tag.toString(16)}, expected 0x${tag.toString(16)}`);
  return c;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Encode one element from its identifier octet and contents. */
export function tlv(tag: number, ...contents: Buffer[]): Buffer {
  const value = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

export const seq = (...items: Buffer[]): Buffer => tlv(TAG.SEQUENCE, ...items);
export const set = (...items: Buffer[]): Buffer => tlv(TAG.SET, ...items);
export const octetString = (value: Buffer): Buffer => tlv(TAG.OCTET_STRING, value);
export const nullValue = (): Buffer => Buffer.from([TAG.NULL, 0x00]);
export const booleanTrue = (): Buffer => Buffer.from([TAG.BOOLEAN, 0x01, 0xff]);
/** BIT STRING with no unused bits. */
export const bitString = (value: Buffer): Buffer => tlv(TAG.BIT_STRING, Buffer.from([0]), value);
/** Context-specific explicit (constructed) tag `[n]`. */
export const explicit = (n: number, ...items: Buffer[]): Buffer => tlv(0xa0 | n, ...items);

/** Unsigned big-endian bytes as a DER INTEGER (adds a 0x00 when the high bit is set). */
export function unsignedInteger(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let body = bytes.subarray(start);
  if (body.length === 0) body = Buffer.from([0]);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(TAG.INTEGER, body);
}

export function smallInteger(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new DerError('integer out of range');
  const bytes: number[] = [];
  let n = value;
  do {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  return unsignedInteger(Buffer.from(bytes));
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map((p) => {
    if (!/^\d+$/.test(p)) throw new DerError(`invalid OID ${dotted}`);
    return BigInt(p);
  });
  if (parts.length < 2 || parts[0] > 2n || (parts[0] < 2n && parts[1] > 39n)) throw new DerError(`invalid OID ${dotted}`);
  const arcs = [parts[0] * 40n + parts[1], ...parts.slice(2)];
  const out: number[] = [];
  for (const arc of arcs) {
    const chunk: number[] = [];
    let n = arc;
    do {
      chunk.unshift(Number(n & 0x7fn));
      n >>= 7n;
    } while (n > 0n);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(TAG.OID, Buffer.from(out));
}

/** Decode the contents of an OBJECT IDENTIFIER to dotted form. */
export function decodeOid(value: Buffer): string {
  if (value.length === 0) throw new DerError('empty OID');
  const arcs: bigint[] = [];
  let n = 0n;
  for (let i = 0; i < value.length; i++) {
    n = (n << 7n) | BigInt(value[i] & 0x7f);
    if (!(value[i] & 0x80)) {
      arcs.push(n);
      n = 0n;
    } else if (i === value.length - 1) {
      throw new DerError('truncated OID');
    }
  }
  const first = arcs[0];
  const head = first < 40n ? [0n, first] : first < 80n ? [1n, first - 40n] : [2n, first - 80n];
  return [...head, ...arcs.slice(1)].map(String).join('.');
}

/** UTCTime before 2050, GeneralizedTime from 2050 (RFC 5280 §4.1.2.5). Seconds precision. */
export function time(date: Date): Buffer {
  const iso = date.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  const year = date.getUTCFullYear();
  const body = iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z';
  if (year >= 1950 && year < 2050) return tlv(TAG.UTC_TIME, Buffer.from(String(year).slice(2) + body, 'ascii'));
  if (year < 0 || year > 9999) throw new DerError('date out of range');
  return tlv(TAG.GENERALIZED_TIME, Buffer.from(String(year).padStart(4, '0') + body, 'ascii'));
}

/** Decode UTCTime / GeneralizedTime (Z form, as DER requires). */
export function decodeTime(node: DerNode): Date {
  const text = node.value.toString('ascii');
  let m: RegExpMatchArray | null;
  if (node.tag === TAG.UTC_TIME && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text))) {
    const yy = Number(m[1]);
    return new Date(Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  if (node.tag === TAG.GENERALIZED_TIME && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text))) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  throw new DerError('unsupported time encoding');
}

/** Contents of a BIT STRING with no unused bits. */
export function bitStringBytes(node: DerNode): Buffer {
  if (node.tag !== TAG.BIT_STRING || node.value.length < 1 || node.value[0] !== 0) throw new DerError('expected a byte-aligned BIT STRING');
  return node.value.subarray(1);
}

export function pemToDer(pem: string, label: string | RegExp): Buffer {
  const re = typeof label === 'string'
    ? new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`)
    : label;
  const m = re.exec(pem);
  if (!m) throw new DerError('PEM block not found');
  const body = m[1].replace(/[\r\n\t ]/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new DerError('PEM body is not base64');
  return Buffer.from(body, 'base64');
}

export function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
}
