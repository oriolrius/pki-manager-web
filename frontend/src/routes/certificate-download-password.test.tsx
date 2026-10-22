import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route } from './certificates.$id';

const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ id: 'leaf' }) }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/components/ui', () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }), useConfirm: () => vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({ certificate: { download: { fetch: download } } }),
  certificate: {
    getById: { useQuery: () => ({ data: {
      id: 'leaf', caId: 'ca', subjectDn: 'CN=Device', serialNumber: '1234', certificateType: 'client',
      status: 'active', notBefore: '2026-01-01', notAfter: '2036-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', certificatePem: 'certificate',
      issuingCA: { id: 'ca', subjectDn: 'CN=Root', serialNumber: '5678' },
    } }) },
    renew: { useMutation: () => ({}) }, revoke: { useMutation: () => ({}) }, delete: { useMutation: () => ({}) },
  },
} }));

beforeEach(() => {
  download.mockResolvedValue({ data: 'Y2VydA==', mimeType: 'application/x-java-keystore', filename: 'device-truststore.jks' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('retains the password for a downloaded certificate truststore after closing the export dialog', async () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'jks-truststore' } });
  const password = (screen.getByLabelText('Export password') as HTMLInputElement).value;
  expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  const buttons = screen.getAllByRole('button', { name: 'Download' });
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(download).toHaveBeenCalledWith(expect.objectContaining({ id: 'leaf', format: 'jks-truststore', password })));
  await waitFor(() => expect(screen.queryByLabelText('Format')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Downloaded file password')).toHaveValue(password);
});

it('always uses the generated password for JKS even after disabling optional encryption for another format', async () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'p12' } });
  fireEvent.click(screen.getByLabelText('Encrypt private key with password'));
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'jks-keystore' } });
  expect(screen.queryByLabelText('Encrypt private key with password')).not.toBeInTheDocument();
  const password = (screen.getByLabelText('Export password') as HTMLInputElement).value;
  expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0]);
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'I Understand, Download' }));
  await waitFor(() => expect(download).toHaveBeenCalledWith(expect.objectContaining({
    id: 'leaf', format: 'jks-keystore', password, encryptPrivateKey: true,
  })));
});
