/**
 * In-memory key store for tests: the same contract as OpenBao Transit (`keystore/types.ts`),
 * with Node crypto keys. It refuses to export non-exportable keys, like OpenBao.
 */
import { generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import type { KeyAlg, KeyRef, KeyStore, KeyStoreState, SignHash } from '../keystore/types.js';

interface Entry { privateKey: KeyObject; publicKey: KeyObject; exportable: boolean; alg: KeyAlg }

export class MemoryKeyStore implements KeyStore {
  readonly keys = new Map<string, Entry>();
  readonly calls: string[] = [];
  constructor(readonly mount = 'test-mount', public caKeysExportable = false) {}

  async createKey(o: { name: string; alg: KeyAlg; exportable: boolean }): Promise<{ ref: KeyRef; publicKey: KeyObject }> {
    this.calls.push(`create:${o.name}`);
    if (this.keys.has(o.name)) throw new Error('key exists');
    const pair = o.alg.startsWith('RSA-')
      ? generateKeyPairSync('rsa', { modulusLength: Number(o.alg.slice(4)) })
      : generateKeyPairSync('ec', { namedCurve: o.alg === 'ECDSA-P256' ? 'prime256v1' : 'secp384r1' });
    this.keys.set(o.name, { ...pair, exportable: o.exportable, alg: o.alg });
    return { ref: { provider: 'openbao', mount: this.mount, name: o.name, version: 1, alg: o.alg }, publicKey: pair.publicKey };
  }

  private entry(ref: KeyRef): Entry {
    const e = this.keys.get(ref.name);
    if (!e || ref.mount !== this.mount || ref.version !== 1) throw new Error('no such key');
    return e;
  }

  async sign(ref: KeyRef, data: Buffer, hash: SignHash): Promise<Buffer> {
    this.calls.push(`sign:${ref.name}:${hash}`);
    return nodeSign(hash, data, this.entry(ref).privateKey);
  }

  async exportPrivateKeyPkcs8(ref: KeyRef): Promise<string> {
    this.calls.push(`export:${ref.name}`);
    const e = this.entry(ref);
    if (!e.exportable) throw new Error('private key material is not exportable');
    return e.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  async destroy(ref: KeyRef): Promise<void> {
    this.calls.push(`destroy:${ref.name}`);
    this.keys.delete(ref.name);
  }

  async status(): Promise<KeyStoreState> {
    return 'ready';
  }
}
