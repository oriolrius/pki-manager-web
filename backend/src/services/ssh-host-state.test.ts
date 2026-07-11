/**
 * BLK-07 (TASK-184) — per-host KRL state derivation. Pure-function tests: the
 * pinned Unknown rule (no usable ECIES registration), the Effective version
 * match, Pending vs Lifting (most recent block event wins), the Lifting →
 * Effective transition, and the distinct unsigned-latest cause.
 */
import { describe, it, expect } from 'vitest';
import { deriveHostKrlState, hasUsableEciesRegistration, ECIES_KEY_ALGORITHM } from './ssh-host-state.js';

const V1 = 'sha256:v1';
const V2 = 'sha256:v2';

const eciesHost = (over: Partial<Parameters<typeof deriveHostKrlState>[0]> = {}) => ({
  opensshHostPubkey: 'ecdsa-sha2-nistp256 AAAA...',
  hostKeyAlgorithm: ECIES_KEY_ALGORITHM,
  lastKrlVersion: V1,
  lastKrlFetchAt: new Date('2026-07-04T10:00:00Z'),
  ...over,
});

const signed = (versionHash: string) => ({ versionHash, caSignature: Buffer.from('sig') });
const unsigned = (versionHash: string) => ({ versionHash, caSignature: null });

const activeBlock = (createdAt: string) => ({ status: 'active' as const, createdAt, liftedAt: null });
const liftedBlock = (createdAt: string, liftedAt: string) => ({ status: 'lifted' as const, createdAt, liftedAt });

describe('BLK-07 deriveHostKrlState', () => {
  it('effective: served version matches the current per-host head', () => {
    const info = deriveHostKrlState(eciesHost(), signed(V1), []);
    expect(info.state).toBe('effective');
    expect(info.unsignedLatest).toBe(false);
    expect(info.servedAt).toBe('2026-07-04T10:00:00.000Z');
    expect(info.currentVersionHash).toBe(V1);
  });

  it('pending: a newer composed KRL has not been pulled (post-block wait and generic propagation)', () => {
    expect(deriveHostKrlState(eciesHost(), signed(V2), [activeBlock('2026-07-04T11:00:00Z')]).state).toBe('pending');
    expect(deriveHostKrlState(eciesHost(), signed(V2), []).state).toBe('pending'); // generic propagation
    expect(deriveHostKrlState(eciesHost({ lastKrlVersion: null }), signed(V2), []).state).toBe('pending'); // never pulled
    expect(deriveHostKrlState(eciesHost(), null, []).state).toBe('pending'); // pre-first-generation
  });

  it('lifting: version mismatch where the MOST RECENT block event is a lift', () => {
    const events = [
      liftedBlock('2026-07-04T09:00:00Z', '2026-07-04T12:00:00Z'),
      activeBlock('2026-07-04T08:00:00Z'),
    ];
    expect(deriveHostKrlState(eciesHost(), signed(V2), events).state).toBe('lifting');
    // A block created AFTER the lift flips it back to pending.
    const reblocked = [...events, activeBlock('2026-07-04T13:00:00Z')];
    expect(deriveHostKrlState(eciesHost(), signed(V2), reblocked).state).toBe('pending');
  });

  it('lifting → effective transition once the post-lift version lands', () => {
    const events = [liftedBlock('2026-07-04T09:00:00Z', '2026-07-04T12:00:00Z')];
    const before = deriveHostKrlState(eciesHost({ lastKrlVersion: V1 }), signed(V2), events);
    expect(before.state).toBe('lifting');
    const after = deriveHostKrlState(eciesHost({ lastKrlVersion: V2 }), signed(V2), events);
    expect(after.state).toBe('effective');
  });

  it('unknown is pinned to ECIES-registration absence (null pubkey or unsupported key type)', () => {
    expect(deriveHostKrlState(eciesHost({ opensshHostPubkey: null }), signed(V1), []).state).toBe('unknown');
    expect(
      deriveHostKrlState(eciesHost({ hostKeyAlgorithm: 'ssh-ed25519' }), signed(V1), []).state
    ).toBe('unknown');
    // ... and to NOTHING else: a host that never pulled but IS registered is pending, not unknown.
    expect(deriveHostKrlState(eciesHost({ lastKrlVersion: null, lastKrlFetchAt: null }), signed(V1), []).state).toBe('pending');
    expect(hasUsableEciesRegistration({ opensshHostPubkey: 'x', hostKeyAlgorithm: ECIES_KEY_ALGORITHM })).toBe(true);
    expect(hasUsableEciesRegistration({ opensshHostPubkey: 'x', hostKeyAlgorithm: 'ssh-ed25519' })).toBe(false);
  });

  it('unsigned-latest is a distinct cause, surfaced in every state', () => {
    const pending = deriveHostKrlState(eciesHost(), unsigned(V2), []);
    expect(pending.state).toBe('pending');
    expect(pending.unsignedLatest).toBe(true);
    // Even "effective" can carry the cause: a krl-client host run with
    // --allow-unsigned installs unsigned rows, so the served version CAN
    // match an unsigned head.
    const effective = deriveHostKrlState(eciesHost({ lastKrlVersion: V2 }), unsigned(V2), []);
    expect(effective.state).toBe('effective');
    expect(effective.unsignedLatest).toBe(true);
  });
});
