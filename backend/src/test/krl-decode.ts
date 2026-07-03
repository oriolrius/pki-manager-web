/**
 * Minimal structural OpenSSH KRL decoder for test assertions that
 * `ssh-keygen -Q` cannot express (per-CA serial scoping, fingerprint entries,
 * header number). Mirrors the PROTOCOL.krl layout buildKrl emits.
 */
export interface DecodedKrl {
  headerNumber: bigint;
  serialsByCaHex: Map<string, bigint[]>;
  hashes: string[];
}

export function decodeKrl(blob: Buffer): DecodedKrl {
  const headerNumber = blob.readBigUInt64BE(8 + 4);
  let off = 8 + 4 + 8 + 8 + 8; // magic, format_version, krl_version, generated_date, flags
  const readString = () => {
    const len = blob.readUInt32BE(off);
    const data = blob.subarray(off + 4, off + 4 + len);
    off += 4 + len;
    return data;
  };
  readString(); // reserved
  readString(); // comment
  const serialsByCaHex = new Map<string, bigint[]>();
  const hashes: string[] = [];
  while (off < blob.length) {
    const type = blob.readUInt8(off);
    off += 1;
    const data = readString();
    if (type === 1) {
      // CERTIFICATES: string ca_key, string reserved, byte 0x20, string serial-list
      let o = 0;
      const caLen = data.readUInt32BE(o);
      const caKey = data.subarray(o + 4, o + 4 + caLen);
      o += 4 + caLen;
      o += 4 + data.readUInt32BE(o); // reserved
      const sub = data.readUInt8(o);
      o += 1;
      if (sub !== 0x20) continue;
      const listLen = data.readUInt32BE(o);
      const list = data.subarray(o + 4, o + 4 + listLen);
      const serials: bigint[] = [];
      for (let i = 0; i < list.length; i += 8) serials.push(list.readBigUInt64BE(i));
      serialsByCaHex.set(caKey.toString('hex'), serials);
    } else if (type === 5) {
      let o = 0;
      while (o < data.length) {
        const l = data.readUInt32BE(o);
        hashes.push(data.subarray(o + 4, o + 4 + l).toString('hex'));
        o += 4 + l;
      }
    }
  }
  return { headerNumber, serialsByCaHex, hashes };
}
