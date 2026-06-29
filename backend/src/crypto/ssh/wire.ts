/**
 * RFC 4251 §5 SSH wire-format primitives — the shared serialization core for
 * OpenSSH certificates (crypto/ssh/openssh-cert.ts) and KRLs (crypto/ssh/krl.ts).
 *
 * Dependency-free (no sshpk/ssh2/node-forge). Everything is big-endian.
 */

/** Builds an SSH wire byte stream. */
export class SshWriter {
  private chunks: Buffer[] = [];

  /** Raw bytes, no length prefix. */
  bytes(buf: Buffer): this {
    this.chunks.push(buf);
    return this;
  }

  /** uint32 (4 bytes, big-endian). */
  uint32(n: number): this {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n >>> 0, 0);
    this.chunks.push(b);
    return this;
  }

  /** uint64 (8 bytes, big-endian) — OpenSSH serials and timestamps. */
  uint64(n: bigint): this {
    const b = Buffer.allocUnsafe(8);
    b.writeBigUInt64BE(BigInt.asUintN(64, n), 0);
    this.chunks.push(b);
    return this;
  }

  /** uint8. */
  byte(n: number): this {
    this.chunks.push(Buffer.from([n & 0xff]));
    return this;
  }

  /** string: a uint32 length followed by that many bytes (RFC 4251 "string"). */
  string(data: Buffer | string): this {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    this.uint32(buf.length);
    this.chunks.push(buf);
    return this;
  }

  /**
   * mpint: a two's-complement, big-endian multiple-precision integer, encoded as
   * a `string`. Leading zero bytes are stripped; a 0x00 is prepended when the MSB
   * is set so the value reads as positive. Zero encodes as an empty string.
   * (ECDSA signature r/s components are always positive and non-zero.)
   */
  mpint(value: Buffer): this {
    let i = 0;
    while (i < value.length && value[i] === 0) i++;
    let v = value.subarray(i);
    if (v.length === 0) {
      return this.string(Buffer.alloc(0));
    }
    if (v[0] & 0x80) {
      v = Buffer.concat([Buffer.from([0x00]), v]);
    }
    return this.string(v);
  }

  /** name-list: a comma-separated list of names, encoded as a single `string`. */
  nameList(names: string[]): this {
    return this.string(names.join(","));
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Reads an SSH wire byte stream. */
export class SshReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  uint32(): number {
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  uint64(): bigint {
    const v = this.buf.readBigUInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  byte(): number {
    return this.buf[this.offset++];
  }

  /** Reads a length-prefixed string as raw bytes. */
  string(): Buffer {
    const len = this.uint32();
    if (this.offset + len > this.buf.length) {
      throw new Error("ssh-wire: string length exceeds buffer");
    }
    const v = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return v;
  }

  /** Reads a length-prefixed string as UTF-8. */
  cstring(): string {
    return this.string().toString("utf8");
  }

  get bytesRead(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  atEnd(): boolean {
    return this.offset >= this.buf.length;
  }
}

/**
 * Encode a list of principals (or any string list) as the OpenSSH certificate
 * "valid principals" field: a `string` whose content is a sequence of `string`s.
 * An empty list yields an empty inner buffer.
 */
export function encodeStringList(items: string[]): Buffer {
  const inner = new SshWriter();
  for (const item of items) inner.string(item);
  return inner.build();
}

/**
 * Encode the OpenSSH certificate critical-options / extensions field: a `string`
 * whose content is a sequence of (name, data) pairs **sorted lexicographically by
 * name** (a hard requirement — sshd and ssh-keygen reject unsorted maps).
 *
 * - Flag extensions (permit-pty, …) have an empty `data`.
 * - Valued options (force-command, source-address) wrap their value as a single
 *   inner `string` inside `data`.
 */
export function encodeOptions(options: Array<{ name: string; value?: string }>): Buffer {
  const sorted = [...options].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const w = new SshWriter();
  for (const opt of sorted) {
    w.string(opt.name);
    if (opt.value === undefined || opt.value === "") {
      w.string(Buffer.alloc(0)); // flag: empty data
    } else {
      w.string(new SshWriter().string(opt.value).build()); // valued: data = string(value)
    }
  }
  return w.build();
}
