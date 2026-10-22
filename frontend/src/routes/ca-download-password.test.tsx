import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from './cas.$id';
import { downloadFile } from '@/lib/download';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ id: 'test-ca' }) }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/download', () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/config', () => ({ getApiUrl: () => 'https://pki.example/trpc' }));
vi.mock('@/components/ui', () => ({ useToast: () => ({ error: vi.fn() }), useConfirm: () => vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({}),
  ca: {
    getById: { useQuery: () => ({ data: {
      id: 'test-ca', subjectDn: 'CN=Root', serialNumber: '1234', keyAlgorithm: 'RSA-2048',
      status: 'active', kmsKeyId: 'kms-key', notBefore: '2026-01-01', notAfter: '2036-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', certificatePem: 'certificate',
    } }) },
    revoke: { useMutation: () => ({}) }, delete: { useMutation: () => ({}) },
  },
} }));
const Page = Route.options.component as ComponentType;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('CA export passwords', () => {
  it.each(['p12-truststore', 'jks-truststore', 'p12-keystore', 'jks-keystore'])('downloads %s with the visible generated password', async (format) => {
    render(<Page />);
    const password = (screen.getByLabelText('Export password') as HTMLInputElement).value;
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`format=${format}`) }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(
      `https://pki.example/api/v1/cas/test-ca/download?format=${format}&password=${password}`,
      expect.any(String),
    ));
    expect(screen.getByLabelText('Export password')).toHaveValue(password);
    expect(screen.getByLabelText('Downloaded file password')).toHaveValue(password);
    fireEvent.click(screen.getByRole('button', { name: 'Generate new password' }));
    expect(screen.getByLabelText('Export password')).not.toHaveValue(password);
    expect(screen.getByLabelText('Downloaded file password')).toHaveValue(password);
    expect(screen.queryByText(/password=\*\*\*/)).not.toBeInTheDocument();
  });

  it('uses an edited password for the protected download and blocks empty passwords', async () => {
    render(<Page />);
    const field = screen.getByLabelText('Export password');
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /format=p12-truststore/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /format=jks-keystore/ })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Edited#Password&123' } });
    fireEvent.click(screen.getByRole('button', { name: /format=p12-truststore/ }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining('&password=Edited%23Password%26123'), expect.any(String),
    ));
  });

  it('copies a protected URL with the displayed password', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<Page />);
    const password = (screen.getByLabelText('Export password') as HTMLInputElement).value;
    const formats = screen.getByRole('combobox');
    fireEvent.change(formats, { target: { value: 'p12-keystore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `https://pki.example/api/v1/cas/test-ca/download?format=p12-keystore&password=${password}`,
    ));
  });
});
