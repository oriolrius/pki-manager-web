/**
 * TASK-244 — Offboard confirm copy (N active certs, disables, irreversible,
 * Disable-vs-Offboard hint) and the flow's success / cancel / failure handling.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConfirmOptions } from '@/components/ui';
import { OffboardDialogBody } from './OffboardDialogBody';
import {
  activeCertsPhrase,
  offboardIdentityFlow,
  OFFBOARD_HINT_COPY,
  type OffboardFlowDeps,
} from './offboard-flow';

function makeDeps(over: Partial<OffboardFlowDeps> = {}) {
  return {
    subject: 'alice@corp',
    confirm: vi.fn(async () => ({ confirmed: true, reason: 'left the company' })),
    countActiveCerts: vi.fn(async () => 3),
    offboard: vi.fn(async () => ({ ok: true })),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...over,
  } satisfies OffboardFlowDeps;
}

describe('activeCertsPhrase', () => {
  it('pluralises and handles an unknown count', () => {
    expect(activeCertsPhrase(0)).toBe('0 active certificates');
    expect(activeCertsPhrase(1)).toBe('1 active certificate');
    expect(activeCertsPhrase(3)).toBe('3 active certificates');
    expect(activeCertsPhrase(null)).toBe('every active certificate');
  });
});

describe('OffboardDialogBody', () => {
  it('states the count, the disable and that it cannot be undone', () => {
    render(<OffboardDialogBody subject="alice@corp" activeCerts={3} />);
    expect(screen.getByText('3 active certificates')).toBeInTheDocument();
    expect(screen.getByText('disables the identity')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText(/added to the KRL/)).toBeInTheDocument();
  });

  it('points at Disable for the no-revocation case', () => {
    render(<OffboardDialogBody subject="alice@corp" activeCerts={1} />);
    expect(screen.getByText(/use/i).textContent).toContain('Disable');
  });
});

describe('Disable vs Offboard hints', () => {
  it('the Disable hint says the KRL is untouched, the Offboard hint says it revokes', () => {
    expect(OFFBOARD_HINT_COPY.disable).toMatch(/does not touch the KRL/);
    expect(OFFBOARD_HINT_COPY.offboard).toMatch(/revokes every active certificate/);
    expect(OFFBOARD_HINT_COPY.offboard).toMatch(/cannot be undone/);
  });
});

describe('offboardIdentityFlow', () => {
  it('confirms with a danger dialog + optional reason, offboards with the reason, reports the count', async () => {
    const deps = makeDeps();
    await expect(offboardIdentityFlow(deps)).resolves.toBe('done');
    const opts = (deps.confirm.mock.calls as unknown as [ConfirmOptions][])[0][0];
    expect(opts.title).toBe('Offboard alice@corp?');
    expect(opts.confirmLabel).toBe('Offboard');
    expect(opts.tone).toBe('danger');
    expect(opts.reason?.required).toBeFalsy();
    expect(deps.offboard).toHaveBeenCalledWith('left the company');
    expect(deps.onSuccess).toHaveBeenCalledWith(3);
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => ({ confirmed: false })) });
    await expect(offboardIdentityFlow(deps)).resolves.toBe('cancelled');
    expect(deps.offboard).not.toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('reports the server error and does not signal success', async () => {
    const deps = makeDeps({ offboard: vi.fn(async () => { throw new Error('KRL signing failed'); }) });
    await expect(offboardIdentityFlow(deps)).resolves.toBe('failed');
    expect(deps.onError).toHaveBeenCalledWith('Failed to offboard identity: KRL signing failed');
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('still opens the dialog when the certificate count cannot be read', async () => {
    const deps = makeDeps({ countActiveCerts: vi.fn(async () => { throw new Error('boom'); }) });
    await expect(offboardIdentityFlow(deps)).resolves.toBe('done');
    expect(deps.onSuccess).toHaveBeenCalledWith(null);
  });
});
