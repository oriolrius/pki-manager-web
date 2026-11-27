/**
 * In-memory key store whose signing can be slowed, held or made to fail: stands in for OpenBao
 * Transit when a test needs concurrent publishers, a lost lease or a sealed key store.
 */
import type { KeyRef, SignHash } from '../keystore/types.js';
import { MemoryKeyStore } from './memory-keystore.js';

export class ControlledKeyStore extends MemoryKeyStore {
  /** Wait before each signature. */
  delayMs = 0;
  /** When set, every signature fails with this error (for example a sealed key store). */
  failure: Error | null = null;
  signCalls = 0;
  private readonly holds: Promise<void>[] = [];

  /** The next signature waits until the returned function is called. */
  holdNextSign(): () => void {
    let release!: () => void;
    this.holds.push(new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  override async sign(ref: KeyRef, data: Buffer, hash: SignHash): Promise<Buffer> {
    this.signCalls++;
    const hold = this.holds.shift();
    if (hold) await hold;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failure) throw this.failure;
    return super.sign(ref, data, hash);
  }

  reset(): void {
    this.delayMs = 0;
    this.failure = null;
    this.holds.length = 0;
  }
}

/** One instance for the module mock of `kms/service.js` and the test that controls it. */
export const controlledKeyStore = new ControlledKeyStore('test-mount', true);
