import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route } from './certificates';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => navigate,
  useMatchRoute: () => () => false,
  Outlet: () => null,
}));
vi.mock('@/components/ui', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({}),
  ca: { list: { useQuery: () => ({ data: [{ id: 'issuing-ca', subject: 'CN=Issuing Root' }] }) } },
  certificate: {
    // Match the actual list response: caId is present; issuingCA is not.
    list: { useQuery: () => ({ isSuccess: true, data: { items: [{
      id: 'device-certificate', caId: 'issuing-ca', subjectDn: 'CN=Device',
      serialNumber: '1234', certificateType: 'client', status: 'active',
      notBefore: '2026-01-01', notAfter: '2036-01-01',
      sanDns: null, sanIp: null, sanEmail: null,
    }], totalCount: 1 } }) },
    bulkRevoke: { useMutation: () => ({}) },
    bulkRenew: { useMutation: () => ({}) },
    bulkDelete: { useMutation: () => ({}) },
    bulkDownload: { useQuery: () => ({}) },
  },
} }));

beforeEach(() => { navigate.mockClear(); localStorage.clear(); });

it('opens the issuing CA using the list caId, while certificate cells open the certificate', () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  const row = screen.getByText('Device').closest('tr');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByText('Issuing Root'));
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: '/cas/$id', params: { id: 'issuing-ca' } });

  navigate.mockClear();
  fireEvent.click(within(row!).getByText('Device'));
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: '/certificates/device-certificate' });
});
