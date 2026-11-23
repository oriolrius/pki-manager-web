/**
 * TASK-248 — the host Access card tags each row with its source (certificate /
 * grant / both) and offers "Block user…" only for identities of the host zone.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const ACCESS = {
  hostId: 'h1',
  fqdn: 'web1.lab',
  zoneId: 'z1',
  state: { state: 'effective', unsignedLatest: false, servedAt: null },
  entries: [
    { identityId: 'i-a', subject: 'alice', identityStatus: 'active', viaRoles: ['ops'], localAccounts: ['root'], source: 'certificate', blocked: false, block: null },
    { identityId: 'i-b', subject: 'bob', identityStatus: 'active', viaRoles: ['ops', 'web'], localAccounts: ['deploy', 'root'], source: 'both', blocked: false, block: null },
    { identityId: 'i-c', subject: 'carol', identityStatus: 'active', viaRoles: ['web'], localAccounts: ['deploy'], source: 'grant', blocked: false, block: null },
  ],
};

vi.mock('@/components/ui', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
  useConfirm: () => vi.fn(),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    ssh: {
      host: { access: { useQuery: () => ({ data: ACCESS, isLoading: false, isError: false }) } },
      user: {
        listIdentities: {
          useQuery: () => ({
            data: [
              { id: 'i-a', subject: 'alice', zoneId: 'z1' },
              { id: 'i-d', subject: 'dave', zoneId: 'z1' },
              { id: 'i-x', subject: 'xena-other-zone', zoneId: 'z2' },
            ],
          }),
        },
      },
      block: {
        block: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        unblock: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
    },
  },
}));

import { HostAccessCard } from './HostAccessCard';
import { ACCESS_SOURCE } from './principal-copy';

describe('HostAccessCard — row source', () => {
  it('shows certificate / grant / both next to each identity, with a hover explanation', () => {
    render(<HostAccessCard hostId="h1" />);
    const row = (name: string) => screen.getByText(name).closest('tr')!;
    expect(within(row('alice')).getByText('· certificate')).toHaveAttribute('title', ACCESS_SOURCE.certificate.hint);
    expect(within(row('bob')).getByText('· certificate + grant')).toBeInTheDocument();
    expect(within(row('carol')).getByText('· grant')).toBeInTheDocument();
    expect(within(row('bob')).getByText('ops, web → deploy, root')).toBeInTheDocument();
  });

  it('"Block user…" lists only not-listed identities of the host zone', () => {
    render(<HostAccessCard hostId="h1" />);
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Block user…', 'dave']);
  });
});
