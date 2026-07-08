/**
 * BLK-09 (TASK-186) — state pill derivation, the pinned confirm copy with both
 * warnings, and the block/unblock flows (invalidation + feedback) via the
 * dependency-injected flow helpers the components wire to window.confirm etc.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { stateLabel, statePillClasses, stateTooltip } from './host-krl-state';
import { HostKrlStatePill } from './HostKrlStatePill';
import { buildBlockConfirmMessage, blockFlow, unblockFlow, type BlockFlowDeps } from './block-flows';

const collision = { identityId: 'c1', subject: 'bob@corp', fingerprint: 'SHA256:x' };

function makeDeps(over: Partial<BlockFlowDeps> = {}): BlockFlowDeps & {
  calls: { alerts: string[]; confirms: string[] };
} {
  const calls = { alerts: [] as string[], confirms: [] as string[] };
  return {
    confirmFn: vi.fn((m: string) => {
      calls.confirms.push(m);
      return true;
    }),
    promptFn: vi.fn(() => 'left the team'),
    alertFn: vi.fn((m: string) => calls.alerts.push(m)),
    fetchCollisions: vi.fn(async () => []),
    block: vi.fn(async () => ({})),
    unblock: vi.fn(async () => ({})),
    invalidate: vi.fn(),
    calls,
    ...over,
  };
}

describe('state pill derivation', () => {
  it('maps the four states to label + palette', () => {
    expect(stateLabel('effective')).toBe('Enforced');
    expect(statePillClasses('effective')).toContain('green');
    expect(stateLabel('pending')).toBe('Rolling out');
    expect(statePillClasses('pending')).toContain('amber');
    expect(stateLabel('lifting')).toBe('Clearing');
    expect(statePillClasses('lifting')).toContain('amber');
    expect(stateLabel('unknown')).toBe('Not enforced');
    expect(statePillClasses('unknown')).toContain('red');
  });

  it('tooltip carries the delivery-not-install honesty and the unsigned cause', () => {
    const tip = stateTooltip({ state: 'effective', unsignedLatest: false, servedAt: '2026-07-04T10:00:00Z' });
    expect(tip).toMatch(/pulled the revocation list that includes this block/);
    expect(tip).toContain('not the final on-disk install');
    const unsigned = stateTooltip({ state: 'pending', unsignedLatest: true, servedAt: null });
    expect(unsigned).toContain('could not be signed');
    expect(stateTooltip({ state: 'unknown', unsignedLatest: false, servedAt: null })).toContain('cannot take effect');
  });

  it('renders the pill with tooltip and signing-pending suffix', () => {
    const { getByTitle, getByText } = render(
      <HostKrlStatePill state={{ state: 'pending', unsignedLatest: true, servedAt: null }} />
    );
    expect(getByText(/Rolling out \(signing pending\)/)).toBeTruthy();
    expect(getByTitle(/could not be signed/)).toBeTruthy();
  });
});

describe('block confirm copy (pinned by decision-016)', () => {
  const target = { subject: 'alice@corp', fqdn: 'web1.example.com', hostState: 'effective' as const };

  it('uses the exact decision copy', () => {
    expect(buildBlockConfirmMessage(target, [])).toBe(
      'Block alice@corp on web1.example.com? Access to all other hosts is unaffected.'
    );
  });

  it('adds the shared-key over-block warning when the API reports a collision', () => {
    const msg = buildBlockConfirmMessage(target, [collision]);
    expect(msg).toContain('this key is also certified for bob@corp — blocking will deny both on this host');
  });

  it('adds the HARD warning when the host is not on a per-host channel', () => {
    const msg = buildBlockConfirmMessage({ ...target, hostState: 'unknown' }, []);
    expect(msg).toContain('the block will NOT be enforced');
  });
});

describe('blockFlow / unblockFlow', () => {
  const target = { hostId: 'h1', fqdn: 'web1.example.com', identityId: 'i1', subject: 'alice@corp', hostState: 'pending' as const };

  it('fetches collisions, confirms, prompts a reason, blocks, invalidates, and reports Pending', async () => {
    const deps = makeDeps({ fetchCollisions: vi.fn(async () => [collision]) });
    const ok = await blockFlow(deps, target);
    expect(ok).toBe(true);
    expect(deps.calls.confirms[0]).toContain('bob@corp'); // warning reached the confirm
    expect(deps.block).toHaveBeenCalledWith({ hostId: 'h1', identityId: 'i1', reason: 'left the team' });
    expect(deps.invalidate).toHaveBeenCalledTimes(1);
    expect(deps.calls.alerts[0]).toMatch(/blocked on web1\.example\.com.*Pending/);
  });

  it('a declined confirm blocks nothing and invalidates nothing', async () => {
    const deps = makeDeps({ confirmFn: vi.fn(() => false) });
    expect(await blockFlow(deps, target)).toBe(false);
    expect(deps.block).not.toHaveBeenCalled();
    expect(deps.invalidate).not.toHaveBeenCalled();
  });

  it('a cancelled reason prompt still blocks (reason optional); API failure surfaces and skips invalidation', async () => {
    const deps = makeDeps({ promptFn: vi.fn(() => null) });
    await blockFlow(deps, target);
    expect(deps.block).toHaveBeenCalledWith({ hostId: 'h1', identityId: 'i1', reason: undefined });

    const failing = makeDeps({ block: vi.fn(async () => Promise.reject(new Error('already blocked'))) });
    expect(await blockFlow(failing, target)).toBe(false);
    expect(failing.calls.alerts[0]).toContain('Block failed: already blocked');
    expect(failing.invalidate).not.toHaveBeenCalled();
  });

  it('over-block warning is never silently lost: a failed pre-check is backstopped by the block response', async () => {
    const deps = makeDeps({
      fetchCollisions: vi.fn(async () => Promise.reject(new Error('network blip'))),
      block: vi.fn(async () => ({ warnings: { sharedKeyCollisions: [collision] } })),
    });
    const ok = await blockFlow(deps, target);
    expect(ok).toBe(true);
    expect(deps.calls.confirms[0]).not.toContain('bob@corp'); // pre-check failed — no warning in confirm
    expect(deps.calls.alerts[0]).toContain('bob@corp'); // ... so the response backstop surfaces it
  });

  it('unblock is symmetric: warns about Lifting, unblocks, invalidates', async () => {
    const deps = makeDeps();
    const ok = await unblockFlow(deps, target);
    expect(ok).toBe(true);
    expect(deps.calls.confirms[0]).toContain('Lifting');
    expect(deps.unblock).toHaveBeenCalledWith({ hostId: 'h1', identityId: 'i1' });
    expect(deps.invalidate).toHaveBeenCalledTimes(1);
    expect(deps.calls.alerts[0]).toContain('Lifting');
  });
});
