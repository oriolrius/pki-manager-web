/**
 * TASK-244 — the Offboard button on the SSH users page: shown next to Disable for
 * an active identity only, and wired to ssh.user.offboard through the confirm dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  offboardAsync: vi.fn(async () => ({ ok: true })),
  confirm: vi.fn(async () => ({ confirmed: true, reason: 'left' })),
  fetchCerts: vi.fn(async () => [{ status: 'active' }, { status: 'active' }, { status: 'revoked' }]),
  invalidateIdentities: vi.fn(),
  toastSuccess: vi.fn(),
  identities: [] as Record<string, unknown>[],
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => h.navigate,
  useMatchRoute: () => () => false,
  Outlet: () => null,
}));
vi.mock('@/components/ui', () => ({
  useToast: () => ({ error: vi.fn(), success: h.toastSuccess }),
  useConfirm: () => h.confirm,
  Combobox: () => null,
  SearchInput: () => null,
}));
vi.mock('@/lib/zone-context', () => ({
  useZone: () => ({ zoneId: undefined, isAll: false, zoneNameById: (id: string) => id, zones: [] }),
}));
vi.mock('@/components/ssh/ZonePicker', () => ({ ZonePicker: () => null }));

// Every procedure is a hook returning an empty result, except the ones this test drives.
const hook = (over: Record<string, unknown> = {}) =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop in over) return over[prop as string];
        if (prop === 'useQuery') return () => ({ data: undefined, isLoading: false, isSuccess: false });
        if (prop === 'useMutation') return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
        return hook();
      },
    }
  );
vi.mock('@/lib/trpc', () => ({
  trpc: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'useUtils')
          return () => ({
            ssh: { user: { listIdentities: { invalidate: h.invalidateIdentities }, listCertificates: { fetch: h.fetchCerts, invalidate: vi.fn() } }, krl: { invalidate: vi.fn() } },
          });
        if (prop === 'ssh') {
          const user = hook({
            listIdentities: { useQuery: () => ({ data: h.identities, isSuccess: true }) },
            offboard: { useMutation: () => ({ mutateAsync: h.offboardAsync, mutate: vi.fn(), isPending: false }) },
          });
          return new Proxy({}, { get: (_t2, router) => (router === 'user' ? user : hook()) });
        }
        return hook();
      },
    }
  ),
}));

import { Route } from './ssh.users';

const identity = (over: Record<string, unknown>) => ({
  id: 'id-1', subject: 'alice@corp', email: null, status: 'active', zoneId: 'z', createdAt: '2026-01-01', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.confirm.mockResolvedValue({ confirmed: true, reason: 'left' });
});

describe('SSH users page — Offboard', () => {
  it('shows Offboard next to Disable for an active identity, not for a disabled one', () => {
    h.identities = [identity({}), identity({ id: 'id-2', subject: 'bob@corp', status: 'disabled' })];
    const Page = Route.options.component as ComponentType;
    render(<Page />);
    expect(screen.getAllByRole('button', { name: 'Offboard' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1);
  });

  it('offboards through the confirm dialog with the reason and the active-cert count', async () => {
    h.identities = [identity({})];
    const Page = Route.options.component as ComponentType;
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Offboard' }));
    await waitFor(() => expect(h.offboardAsync).toHaveBeenCalledWith({ id: 'id-1', reason: 'left' }));
    const opts = (h.confirm.mock.calls as unknown as [{ title: string }][])[0][0];
    expect(opts.title).toBe('Offboard alice@corp?');
    expect(h.fetchCerts).toHaveBeenCalledWith({ identityId: 'id-1' });
    await waitFor(() => expect(h.invalidateIdentities).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('2 certificates revoked'));
  });

  it('does not call the API when the dialog is cancelled', async () => {
    h.identities = [identity({})];
    h.confirm.mockResolvedValue({ confirmed: false, reason: undefined });
    const Page = Route.options.component as ComponentType;
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Offboard' }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.offboardAsync).not.toHaveBeenCalled();
  });
});
