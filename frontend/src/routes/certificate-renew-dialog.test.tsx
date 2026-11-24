import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route } from './certificates.$id';

const { renew } = vi.hoisted(() => ({ renew: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ id: 'leaf' }) }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/components/ui', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
  useConfirm: () => vi.fn(),
}));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({ certificate: { list: { invalidate: vi.fn() }, download: { fetch: vi.fn() } } }),
  certificate: {
    getById: { useQuery: () => ({ refetch: vi.fn(), data: {
      id: 'leaf', caId: 'ca', subjectDn: 'CN=Device', serialNumber: '1234', certificateType: 'client',
      status: 'active', notBefore: '2026-01-01', notAfter: '2036-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', certificatePem: 'certificate',
      issuingCA: { id: 'ca', subjectDn: 'CN=Root', serialNumber: '5678' },
    } }) },
    renew: { useMutation: () => ({ mutateAsync: renew, isPending: false }) },
    revoke: { useMutation: () => ({}) }, delete: { useMutation: () => ({}) },
  },
} }));

beforeEach(() => { renew.mockReset(); renew.mockResolvedValue({ id: 'new' }); });

it('states what renew does to the key and the old certificate, and defaults to new key / old stays active', async () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
  expect(screen.getByText(/By default it also creates a new private key/)).toBeInTheDocument();
  expect(screen.getByText(/previous certificate stays active until it expires/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Renew certificate' })).getByRole('button', { name: 'Renew' }));
  await waitFor(() => expect(renew).toHaveBeenCalledWith({ id: 'leaf', generateNewKey: true, revokeOriginal: false }));
});

it('sends key reuse and revoke-superseded when the user opts in', async () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
  fireEvent.click(screen.getByLabelText(/Keep the current key pair/));
  fireEvent.click(screen.getByLabelText(/Revoke the previous certificate/));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Renew certificate' })).getByRole('button', { name: 'Renew' }));
  await waitFor(() => expect(renew).toHaveBeenCalledWith({ id: 'leaf', generateNewKey: false, revokeOriginal: true }));
});
