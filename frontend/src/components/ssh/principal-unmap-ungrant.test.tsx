/**
 * TASK-245 — remove a host mapping (× per row, confirm explains the host keeps
 * accepting the principal until the files are deployed) and the identity's
 * "Allowed principals" section (list / add / remove grants).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  confirm: vi.fn(async () => ({ confirmed: true })),
  unmap: vi.fn(),
  grant: vi.fn(),
  revokeGrant: vi.fn(),
  catalogInput: undefined as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/components/ui', () => ({
  useToast: () => ({ error: h.toastError, success: h.toastSuccess }),
  useConfirm: () => h.confirm,
}));
vi.mock('@/components/ConfigSnippet', () => ({
  ConfigSnippet: ({ title }: { title: string }) => <div>{title}</div>,
}));

const inv = { invalidate: vi.fn() };
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ssh: {
        principal: { render: inv, hostMappings: inv, staleHosts: inv, mappingsByPrincipal: inv, listGrants: inv },
        host: { deployBundle: inv, access: inv },
      },
    }),
    ssh: {
      principal: {
        list: {
          useQuery: (input: unknown) => {
            h.catalogInput = input;
            return {
              data: [
                { id: 'p-ops', zoneId: 'z1', name: 'ops', description: null },
                { id: 'p-web', zoneId: 'z1', name: 'web', description: null },
              ],
              isLoading: false,
            };
          },
        },
        staleHosts: { useQuery: () => ({ data: [] }) },
        render: {
          useQuery: () => ({
            data: { directive: 'AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u', files: { root: 'ops\nops@h\n' }, stale: false },
            isLoading: false,
          }),
        },
        hostMappings: {
          useQuery: () => ({ data: [{ hostId: 'h1', principalId: 'p-ops', name: 'ops', localAccount: 'root' }] }),
        },
        listGrants: {
          useQuery: () => ({
            data: [{ identityId: 'i1', principalId: 'p-ops', name: 'ops', description: null }],
            isLoading: false,
          }),
        },
        map: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        markPushed: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        unmap: { useMutation: () => ({ mutate: h.unmap, isPending: false }) },
        grant: { useMutation: () => ({ mutate: h.grant, isPending: false }) },
        revokeGrant: { useMutation: () => ({ mutate: h.revokeGrant, isPending: false }) },
      },
    },
  },
}));

import { HostPrincipalMappingCard, unmapConfirmCopy } from './HostPrincipalMappingCard';
import { IdentityGrantsSection, GRANTS_EXPLAINER } from './IdentityGrantsSection';

beforeEach(() => {
  vi.clearAllMocks();
  h.confirm.mockResolvedValue({ confirmed: true });
});

describe('host mapping card — remove a mapping', () => {
  it('lists each mapping row with a remove action', () => {
    render(<HostPrincipalMappingCard hostId="h1" title="web1" />);
    expect(screen.getByText('ops → root')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove mapping ops → root' })).toBeInTheDocument();
  });

  it('confirms with the "keeps accepting until deployed" copy, then unmaps', async () => {
    render(<HostPrincipalMappingCard hostId="h1" title="web1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove mapping ops → root' }));
    await waitFor(() =>
      expect(h.unmap).toHaveBeenCalledWith({ hostId: 'h1', principalId: 'p-ops', localAccount: 'root' }, expect.any(Object))
    );
    expect(h.confirm).toHaveBeenCalledWith(unmapConfirmCopy('ops', 'root'));
    expect(unmapConfirmCopy('ops', 'root').description).toMatch(/keeps accepting principal “ops”.*until the updated auth_principals files are deployed/);
  });

  it('does nothing when the confirm is cancelled', async () => {
    h.confirm.mockResolvedValue({ confirmed: false });
    render(<HostPrincipalMappingCard hostId="h1" title="web1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove mapping ops → root' }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.unmap).not.toHaveBeenCalled();
  });
});

describe('identity — Allowed principals', () => {
  const identity = { id: 'i1', subject: 'alice', zoneId: 'z1' };

  it('lists grants, explains enforcement, and offers only ungranted principals of the identity zone', () => {
    render(<IdentityGrantsSection identity={identity} />);
    expect(screen.getByRole('heading', { name: 'Allowed principals' })).toBeInTheDocument();
    expect(screen.getByText(GRANTS_EXPLAINER)).toBeInTheDocument();
    expect(GRANTS_EXPLAINER).toMatch(/entitlement check/);
    expect(GRANTS_EXPLAINER).toMatch(/host Access list/);
    expect(h.catalogInput).toEqual({ zoneId: 'z1' });
    const select = screen.getByRole('combobox', { name: 'Principal to grant' });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Add principal…', 'web']);
  });

  it('grants the selected principal', () => {
    render(<IdentityGrantsSection identity={identity} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Principal to grant' }), { target: { value: 'p-web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    expect(h.grant).toHaveBeenCalledWith({ identityId: 'i1', principalId: 'p-web' }, expect.any(Object));
  });

  it('removes a grant after confirmation', async () => {
    render(<IdentityGrantsSection identity={identity} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove grant ops' }));
    await waitFor(() =>
      expect(h.revokeGrant).toHaveBeenCalledWith({ identityId: 'i1', principalId: 'p-ops' }, expect.any(Object))
    );
    const opts = (h.confirm.mock.calls as unknown as [{ title: string }][])[0][0];
    expect(opts.title).toBe('Remove grant “ops” from alice?');
  });
});
