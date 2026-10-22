import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsPage } from './IntegrationsPage';

const { register, invalidate } = vi.hoisted(() => ({ register: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/components/ui', () => ({
  useConfirm: () => vi.fn(), useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({ integration: { list: { invalidate } } }),
  integration: {
    list: { useQuery: () => ({ data: [{ id: 'scep', name: 'MDM gateway', kind: 'scep', status: 'active', certificatesCount: 12, caSubjectDn: 'CN=Devices', tokenPrefix: 'pkimg_prefix' }] }) },
    register: { useMutation: () => ({ mutate: register, isPending: false }) },
    revoke: { useMutation: () => ({ mutate: vi.fn() }) },
  },
  ca: { list: { useQuery: () => ({ data: [{ id: 'ca', subject: 'CN=Devices', status: 'active' }] }) } },
} }));

beforeEach(() => { vi.clearAllMocks(); });
describe('IntegrationsPage', () => {
  it('shows the integration type and generic certificate count', () => {
    render(<IntegrationsPage />);
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByText('MDM gateway')).toBeInTheDocument();
    expect(screen.getByText('SCEP')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('K8s Clusters')).not.toBeInTheDocument();
  });
  it('registers a dedicated SCEP identity through the generic integration API', () => {
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'scep' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Intune' } });
    fireEvent.change(screen.getByLabelText('Bound CA'), { target: { value: 'ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Integration' }));
    expect(register).toHaveBeenCalledWith({ name: 'Intune', kind: 'scep', caId: 'ca', description: undefined });
  });
});
