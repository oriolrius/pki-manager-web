/**
 * OpenBao Transit implementation of the key store contract (X.509 CA and leaf keys).
 */
import type { KeyObject } from 'node:crypto';
import {
  OpenBaoTransitError, assertKeyMatchesType, getOpenBaoTransitClient, type OpenBaoTransitClient, type TransitHash, type TransitKeyType,
} from '../openbao/x509-transit.js';
import type { KeyAlg, KeyRef, KeyStore, KeyStoreState, SignHash } from './types.js';

const TRANSIT_TYPE: Record<KeyAlg, TransitKeyType> = {
  'RSA-2048': 'rsa-2048',
  'RSA-3072': 'rsa-3072',
  'RSA-4096': 'rsa-4096',
  'ECDSA-P256': 'ecdsa-p256',
  'ECDSA-P384': 'ecdsa-p384',
};
const TRANSIT_HASH: Record<SignHash, TransitHash> = { sha256: 'sha2-256', sha384: 'sha2-384', sha512: 'sha2-512' };

export class OpenBaoKeyStore implements KeyStore {
  constructor(private readonly client: OpenBaoTransitClient = getOpenBaoTransitClient()) {}

  get mount(): string {
    return this.client.cfg.mount;
  }

  get caKeysExportable(): boolean {
    return this.client.cfg.caKeysExportable;
  }

  async createKey(o: { name: string; alg: KeyAlg; exportable: boolean }): Promise<{ ref: KeyRef; publicKey: KeyObject }> {
    const type = TRANSIT_TYPE[o.alg];
    const info = await this.client.createKey(this.mount, o.name, type, o.exportable);
    const publicKey = info.publicKeys.get(1)!;
    assertKeyMatchesType(publicKey, type);
    return { ref: { provider: 'openbao', mount: this.mount, name: o.name, version: 1, alg: o.alg }, publicKey };
  }

  async sign(ref: KeyRef, data: Buffer, hash: SignHash): Promise<Buffer> {
    return this.client.sign(ref.mount, ref.name, ref.version, TRANSIT_HASH[hash], data, { rsa: ref.alg.startsWith('RSA-') });
  }

  async exportPrivateKeyPkcs8(ref: KeyRef): Promise<string> {
    return this.client.exportPrivateKeyPkcs8(ref.mount, ref.name, ref.version);
  }

  async destroy(ref: KeyRef): Promise<void> {
    await this.client.deleteKey(ref.mount, ref.name);
  }

  async status(): Promise<KeyStoreState> {
    try {
      const health = await this.client.health();
      if (!health.initialized) return 'uninitialized';
      if (health.sealed) return 'sealed';
      return (await this.client.tokenValid()) ? 'ready' : 'unauthorized';
    } catch (error) {
      if (error instanceof OpenBaoTransitError && error.status === 403) return 'unauthorized';
      return 'unavailable';
    }
  }
}
