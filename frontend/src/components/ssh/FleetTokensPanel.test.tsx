/**
 * TASK-244 — fleet token screen: zone-scoped list, mint form (presets, CA
 * requirements), the plaintext shown ONCE with a copy button and dismissed on
 * demand, and revoke through the confirm dialog.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mintAsync: vi.fn(),
  mintReset: vi.fn(),
  revoke: vi.fn(),
  confirm: vi.fn(async () => ({ confirmed: true })),
  invalidate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  zone: { zoneId: 'z-prod' as string | undefined, isAll: false },
}));

const CAS = [
  { id: 'hca', caType: 'host', status: 'active', label: 'prod-host-ca', fingerprintSha256: 'SHA256:aaaaaaaaaaaaaaaaaaaa', zoneId: 'z-prod' },
  { id: 'uca', caType: 'user', status: 'active', label: 'prod-user-ca', fingerprintSha256: 'SHA256:bbbbbbbbbbbbbbbbbbbb', zoneId: 'z-prod' },
  { id: 'old', caType: 'host', status: 'retired', label: 'retired-host-ca', fingerprintSha256: 'SHA256:cccccccccccccccccccc', zoneId: 'z-prod' },
  { id: 'dev-hca', caType: 'host', status: 'active', label: 'dev-host-ca', fingerprintSha256: 'SHA256:dddddddddddddddddddd', zoneId: 'z-dev' },
];
const TOKENS = [
  { id: 't1', zoneId: 'z-prod', name: 'web-fleet', tokenPrefix: 'pkimg_AbCd1', userCaId: null, hostCaId: 'hca', opSet: ['sign-host', 'get-principals'], revoked: false, lastSeenAt: '2026-11-01T10:00:00.000Z', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 't2', zoneId: 'z-prod', name: 'old-ci', tokenPrefix: 'pkimg_XyZ98', userCaId: 'uca', hostCaId: null, opSet: ['sign-user'], revoked: true, lastSeenAt: null, createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 't3', zoneId: 'z-dev', name: 'dev-token', tokenPrefix: 'pkimg_Dev00', userCaId: null, hostCaId: 'dev-hca', opSet: ['sign-host'], revoked: false, lastSeenAt: null, createdAt: '2026-10-02T10:00:00.000Z' },
];

vi.mock('@/components/ui', () => ({
  useToast: () => ({ error: h.toastError, success: h.toastSuccess }),
  useConfirm: () => h.confirm,
}));
vi.mock('@/lib/zone-context', () => ({
  useZone: () => ({ zoneId: h.zone.zoneId, isAll: h.zone.isAll, zoneNameById: (id: string) => (id === 'z-prod' ? 'prod' : 'dev') }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ ssh: { token: { list: { invalidate: h.invalidate } } } }),
    ssh: {
      token: {
        list: { useQuery: () => ({ data: TOKENS, isSuccess: true, isLoading: false, isError: false }) },
        mint: { useMutation: () => ({ mutateAsync: h.mintAsync, reset: h.mintReset, isPending: false }) },
        revoke: { useMutation: () => ({ mutate: h.revoke, isPending: false }) },
      },
      ca: {
        list: {
          useQuery: (input: { zoneId?: string }) => ({ data: input?.zoneId ? CAS.filter((c) => c.zoneId === input.zoneId) : CAS }),
        },
      },
    },
  },
}));

import { FleetTokensPanel } from './FleetTokensPanel';

beforeEach(() => {
  vi.clearAllMocks();
  h.zone.zoneId = 'z-prod';
  h.zone.isAll = false;
  h.confirm.mockResolvedValue({ confirmed: true });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'Mint token' }));
const formMint = () => within(screen.getByRole('form', { name: 'Mint token' })).getByRole('button', { name: 'Mint token' });

describe('Fleet tokens — list', () => {
  it('shows only the tokens of the selected zone, with ops, CAs, last used and status', () => {
    render(<FleetTokensPanel />);
    expect(screen.getByRole('heading', { name: 'Fleet tokens' })).toBeInTheDocument();
    expect(screen.getByText('web-fleet')).toBeInTheDocument();
    expect(screen.getByText('old-ci')).toBeInTheDocument();
    expect(screen.queryByText('dev-token')).not.toBeInTheDocument();
    expect(screen.getByText('Host CA: prod-host-ca')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it('offers Revoke only for active tokens', () => {
    render(<FleetTokensPanel />);
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
  });

  it('adds a Zone column and lists every zone under "All zones"', () => {
    h.zone.zoneId = undefined;
    h.zone.isAll = true;
    render(<FleetTokensPanel />);
    expect(screen.getByRole('columnheader', { name: 'Zone' })).toBeInTheDocument();
    expect(screen.getByText('dev-token')).toBeInTheDocument();
  });
});

describe('Fleet tokens — revoke', () => {
  it('asks for confirmation, then revokes', async () => {
    render(<FleetTokensPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith({ id: 't1' }, expect.any(Object)));
    const opts = (h.confirm.mock.calls as unknown as [{ title: string; confirmLabel: string; tone: string }][])[0][0];
    expect(opts.title).toBe('Revoke token "web-fleet"?');
    expect(opts.confirmLabel).toBe('Revoke token');
    expect(opts.tone).toBe('danger');
  });

  it('does not revoke when cancelled', async () => {
    h.confirm.mockResolvedValue({ confirmed: false });
    render(<FleetTokensPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.revoke).not.toHaveBeenCalled();
  });
});

describe('Fleet tokens — mint form', () => {
  it('offers only ACTIVE CAs of the selected zone, split by type', () => {
    render(<FleetTokensPanel />);
    openForm();
    const host = screen.getByLabelText(/Host CA/, { selector: 'select' }) as HTMLSelectElement;
    const user = screen.getByLabelText(/User CA/, { selector: 'select' }) as HTMLSelectElement;
    // no op chosen yet: neither CA is needed
    expect(host).toBeDisabled();
    expect(user).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /sign-host/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /sign-user/ }));
    expect([...host.options].map((o) => o.textContent)).toEqual(['Choose a Host CA', 'prod-host-ca']);
    expect([...user.options].map((o) => o.textContent)).toEqual(['Choose a User CA', 'prod-user-ca']);
  });

  it('presets tick the documented operations', () => {
    render(<FleetTokensPanel />);
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Self-provisioning host with KRL (recommended)' }));
    for (const op of ['sign-host', 'get-principals', 'register-host-pubkey']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(op) })).toBeChecked();
    }
    expect(screen.getByRole('checkbox', { name: /sign-user/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'CI user certs' }));
    expect(screen.getByRole('checkbox', { name: /sign-user/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /sign-host/ })).not.toBeChecked();
  });

  it('keeps Mint disabled until name, ops and the required CA are set', () => {
    render(<FleetTokensPanel />);
    openForm();
    expect(formMint()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'ci-deploy' } });
    fireEvent.click(screen.getByRole('button', { name: 'CI user certs' }));
    // one active User CA in the zone is preselected
    expect(formMint()).not.toBeDisabled();
  });

  it('mints with the chosen CAs and zone, shows the plaintext once, and clears it on dismiss', async () => {
    h.mintAsync.mockResolvedValue({ token: 'pkimg_SECRET_VALUE', record: { id: 'new', name: 'web-fleet-2' } });
    render(<FleetTokensPanel />);
    openForm();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'web-fleet-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Self-provisioning host (no KRL)' }));
    fireEvent.click(formMint());

    await waitFor(() => expect(screen.getByTestId('minted-token')).toHaveTextContent('pkimg_SECRET_VALUE'));
    expect(h.mintAsync).toHaveBeenCalledWith({
      name: 'web-fleet-2',
      opSet: ['sign-host', 'get-principals'],
      hostCaId: 'hca',
      userCaId: undefined,
      zone: 'z-prod',
    });
    expect(h.mintReset).toHaveBeenCalled(); // plaintext dropped from the mutation cache
    expect(h.invalidate).toHaveBeenCalled();
    expect(screen.getByText(/You will not see this token again/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Store it in Ansible Vault/);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pkimg_SECRET_VALUE'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'I have stored the token' }));
    expect(screen.queryByTestId('minted-token')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('pkimg_SECRET_VALUE');
  });

  it('reports a server error and shows no token', async () => {
    h.mintAsync.mockRejectedValue(new Error('CA h belongs to a different zone'));
    render(<FleetTokensPanel />);
    openForm();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Self-provisioning host (no KRL)' }));
    fireEvent.click(formMint());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Failed to mint token: CA h belongs to a different zone'));
    expect(screen.queryByTestId('minted-token')).not.toBeInTheDocument();
  });

  it('under "All zones" labels CAs with their zone and blocks a Host/User CA pair from different zones', () => {
    h.zone.zoneId = undefined;
    h.zone.isAll = true;
    render(<FleetTokensPanel />);
    openForm();
    const host = screen.getByLabelText(/Host CA/, { selector: 'select' }) as HTMLSelectElement;
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'mixed' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /sign-host/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /sign-user/ }));
    expect([...host.options].map((o) => o.textContent)).toContain('dev-host-ca (dev)');
    fireEvent.change(host, { target: { value: 'dev-hca' } });
    fireEvent.change(screen.getByLabelText(/User CA/, { selector: 'select' }), { target: { value: 'uca' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/different zones/);
    expect(formMint()).toBeDisabled();
  });
});
