import { describe, it, expect } from 'vitest';
import { TOKEN_PRESETS, TOKEN_OPS, validateMint, needsHostCa, needsUserCa } from './fleet-token';

describe('presets', () => {
  const byId = Object.fromEntries(TOKEN_PRESETS.map((p) => [p.id, p]));
  it('match the documented op sets', () => {
    expect(byId['host'].label).toBe('Self-provisioning host (no KRL)');
    expect(byId['host'].ops).toEqual(['sign-host', 'get-principals']);
    expect(byId['host-krl'].label).toBe('Self-provisioning host with KRL (recommended)');
    expect(byId['host-krl'].ops).toEqual(['sign-host', 'get-principals', 'register-host-pubkey']);
    expect(byId['ci-user'].label).toBe('CI user certs');
    expect(byId['ci-user'].ops).toEqual(['sign-user']);
  });
  it('every preset op has a one-line help in the catalogue', () => {
    const known = TOKEN_OPS.map((o) => o.op);
    for (const p of TOKEN_PRESETS) for (const op of p.ops) expect(known).toContain(op);
    for (const o of TOKEN_OPS) expect(o.help.length).toBeGreaterThan(10);
  });
});

describe('validateMint (mirrors the backend rules)', () => {
  const base = { name: 'fleet', ops: ['sign-host'] as const, hostCaId: 'h', userCaId: '' };
  it('needs a name and at least one op', () => {
    expect(validateMint({ ...base, ops: [...base.ops], name: ' ' })).toMatch(/name/);
    expect(validateMint({ ...base, ops: [] })).toMatch(/at least one operation/);
  });
  it('sign-user needs a User CA; sign-host / register-host-pubkey need a Host CA', () => {
    expect(validateMint({ ...base, ops: ['sign-user'], hostCaId: '', userCaId: '' })).toMatch(/User CA/);
    expect(validateMint({ ...base, ops: ['sign-host'], hostCaId: '' })).toMatch(/Host CA/);
    expect(validateMint({ ...base, ops: ['register-host-pubkey'], hostCaId: '' })).toMatch(/Host CA/);
  });
  it('accepts valid combinations; get-principals alone needs no CA', () => {
    expect(validateMint({ ...base, ops: ['sign-host'] })).toBeNull();
    expect(validateMint({ name: 'ci', ops: ['sign-user'], hostCaId: '', userCaId: 'u' })).toBeNull();
    expect(validateMint({ name: 'p', ops: ['get-principals'], hostCaId: '', userCaId: '' })).toBeNull();
    expect(needsHostCa(['get-principals'])).toBe(false);
    expect(needsUserCa(['sign-user'])).toBe(true);
  });
});
