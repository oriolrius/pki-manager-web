import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route } from './certificates.$id';

const { renew, record } = vi.hoisted(() => ({ renew: vi.fn(), record: { kmsKeyId: null as string | null } }));
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
      id: 'leaf', caId: 'ca', subjectDn: 'CN=Device', serialNumber: '1234', certificateType: 'server',
      status: 'active', kmsKeyId: record.kmsKeyId, notBefore: '2026-01-01', notAfter: '2036-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', certificatePem: 'certificate',
      issuingCA: { id: 'ca', subjectDn: 'CN=Root', serialNumber: '5678' },
    } }) },
    renew: { useMutation: () => ({ mutateAsync: renew, isPending: false }) },
    revoke: { useMutation: () => ({}) }, delete: { useMutation: () => ({}) },
  },
} }));

beforeEach(() => { renew.mockReset(); renew.mockResolvedValue({ id: 'new' }); record.kmsKeyId = null; });

const Page = () => {
  const Component = Route.options.component as ComponentType;
  return <Component />;
};

it('names the key store and the key reference for a certificate with a local key', () => {
  record.kmsKeyId = 'transit-key-1';
  render(<Page />);
  const storage = screen.getByTestId('cert-key-storage');
  expect(storage).toHaveTextContent('OpenBao Transit');
  expect(screen.getByText('transit-key-1')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/Cosmian/i);
});

it('says that a CSR-only certificate has no private key in PKI Manager', () => {
  render(<Page />);
  expect(screen.getByTestId('cert-key-storage')).toHaveTextContent(/None in PKI Manager: this certificate was signed from a CSR/);
  expect(screen.queryByText('Key reference:')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/Cosmian/i);
});

it('offers only certificate formats for a CSR-only certificate', () => {
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  const values = within(screen.getByLabelText('Format')).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
  expect(values).toEqual(expect.arrayContaining(['pem', 'pem-chain', 'jks-truststore']));
  for (const keyFormat of ['pem-key', 'pkcs12', 'pfx', 'p12', 'jks-keystore', 'docker-volume', 'all']) {
    expect(values).not.toContain(keyFormat);
  }
});

it('disables key reuse on renewal of a CSR-only certificate and always asks for a new key', async () => {
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
  const keep = screen.getByLabelText(/Keep the current key pair/);
  expect(keep).toBeDisabled();
  expect(screen.getByText(/PKI Manager has no private key for this certificate/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Renew certificate' })).getByRole('button', { name: 'Renew' }));
  await waitFor(() => expect(renew).toHaveBeenCalledWith({ id: 'leaf', generateNewKey: true, revokeOriginal: false }));
});
