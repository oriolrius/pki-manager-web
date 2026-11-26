import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from './certificates';
import { validateCertificateListSearch, type CertificateListSearch } from '@/lib/certificate-list-search';

// Issue #53: the list asked for the newest 50 certificates and filtered them in the
// browser. Now the URL holds the list state and the server does filters, sort and paging.

const { navigate, listQuery, state } = vi.hoisted(() => ({
  navigate: vi.fn(),
  listQuery: vi.fn(),
  state: { search: {} as CertificateListSearch, totalCount: 120 },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => navigate,
  useMatchRoute: () => () => false,
  useSearch: () => state.search,
  Outlet: () => null,
}));
vi.mock('@/components/ui', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({}),
  ca: { list: { useQuery: () => ({ data: [
    { id: 'ca-b', subject: 'CN=Beta CA' },
    { id: 'ca-a', subject: 'CN=Alpha CA' },
  ] }) } },
  certificate: {
    list: { useQuery: listQuery },
    bulkRevoke: { useMutation: () => ({}) },
    bulkRenew: { useMutation: () => ({}) },
    bulkDelete: { useMutation: () => ({}) },
    bulkDownload: { useQuery: () => ({}) },
  },
} }));

function pageOf(input: { limit: number; offset: number }) {
  const count = Math.max(0, Math.min(input.limit, state.totalCount - input.offset));
  return Array.from({ length: count }, (_, i) => ({
    id: `cert-${input.offset + i + 1}`, caId: 'ca-a', subjectDn: `CN=host-${input.offset + i + 1}`,
    serialNumber: '01', certificateType: 'server', status: 'active',
    notBefore: '2026-01-01', notAfter: '2036-01-01', sanDns: null, sanIp: null, sanEmail: null,
  }));
}

/** Apply the search updater of the last navigate() call to the current URL state. */
function lastNavigatedSearch(): CertificateListSearch {
  const call = navigate.mock.calls.at(-1)?.[0] as { to: string; search: (prev: CertificateListSearch) => CertificateListSearch };
  expect(call.to).toBe('/certificates');
  return call.search(state.search);
}

const Page = Route.options.component as ComponentType;

beforeEach(() => {
  navigate.mockClear();
  listQuery.mockReset();
  listQuery.mockImplementation((input: { limit: number; offset: number }) => ({
    isSuccess: true,
    data: { items: pageOf(input), totalCount: state.totalCount, limit: input.limit, offset: input.offset },
  }));
  state.search = {};
  state.totalCount = 120;
});
afterEach(() => { vi.useRealTimers(); });

describe('certificate list paging (issue #53)', () => {
  it('asks the server for the first page, newest first, with no filters', () => {
    render(<Page />);
    expect(listQuery).toHaveBeenLastCalledWith(
      { search: undefined, caId: undefined, status: undefined, expiryStatus: undefined, certificateType: undefined,
        sortBy: 'createdAt', sortOrder: 'desc', limit: 50, offset: 0 },
      expect.anything(),
    );
    expect(screen.getByText('1–50 of 120 certificates')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });

  it('sends the URL filters, sort and page to the server', () => {
    state.search = validateCertificateListSearch({
      q: 'web', ca: 'ca-a', status: 'expired', type: 'server', sort: 'notAfter', order: 'asc', page: '2', size: '25',
    });
    render(<Page />);
    expect(listQuery).toHaveBeenLastCalledWith(
      { search: 'web', caId: 'ca-a', status: 'active', expiryStatus: 'expired', certificateType: 'server',
        sortBy: 'notAfter', sortOrder: 'asc', limit: 25, offset: 25 },
      expect.anything(),
    );
  });

  it('shows page 2 from the server and goes to the next and previous page', () => {
    state.search = { page: 2 };
    render(<Page />);
    expect(listQuery).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 50 }), expect.anything());
    expect(screen.getByText('host-51')).toBeTruthy();
    expect(screen.queryByText('host-1')).toBeNull();
    expect(screen.getByText('51–100 of 120 certificates')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(lastNavigatedSearch()).toEqual({ page: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(lastNavigatedSearch()).toEqual({ page: undefined });
  });

  it('clears the bulk selection when the URL changes page', () => {
    const view = render(<Page />);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByText('1 certificate selected')).toBeTruthy();

    state.search = { page: 2 };
    view.rerender(<Page />);
    expect(screen.getByText('host-51')).toBeTruthy();
    expect(screen.queryByText('1 certificate selected')).toBeNull();
  });

  it('updates the expiry label while the page stays open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2035-12-31T23:59:30Z'));
    state.totalCount = 1;
    render(<Page />);
    expect(screen.getByText('1 days left')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByText('1 days left')).toBeNull();
    expect(screen.getByText('Expired', { selector: 'div' })).toBeTruthy();
  });

  it('disables next on the last page', () => {
    state.search = { page: 3 };
    render(<Page />);
    expect(screen.getByText('101–120 of 120 certificates')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back to page 1 when a filter changes, and lists every CA', () => {
    state.search = { page: 3 };
    render(<Page />);
    const caSelect = screen.getByRole('combobox', { name: 'Filter by CA' });
    expect(Array.from((caSelect as HTMLSelectElement).options).map(o => o.textContent))
      .toEqual(['All CAs', 'Alpha CA', 'Beta CA']);

    fireEvent.change(caSelect, { target: { value: 'ca-b' } });
    expect(lastNavigatedSearch()).toEqual({ page: undefined, ca: 'ca-b' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'revoked' } });
    expect(lastNavigatedSearch()).toEqual({ page: undefined, status: 'revoked' });
  });

  it('debounces the text search before it changes the URL', () => {
    vi.useFakeTimers();
    state.search = { page: 2 };
    render(<Page />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search certificates' }), { target: { value: 'api' } });
    act(() => { vi.advanceTimersByTime(200); });
    expect(navigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(150); });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(lastNavigatedSearch()).toEqual({ page: undefined, q: 'api' });
  });

  it('sorts on the server when a column header is clicked', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /Expiration/ }));
    expect(lastNavigatedSearch()).toEqual({ page: undefined, sort: 'notAfter', order: 'asc' });
  });
});

describe('validateCertificateListSearch', () => {
  it('drops unknown and invalid values', () => {
    expect(validateCertificateListSearch({
      q: '  ', status: 'bogus', type: 'x', sort: 'serial', order: 'up', page: '0', size: '7', ca: '',
    })).toEqual({
      q: undefined, ca: undefined, status: undefined, type: undefined,
      sort: undefined, order: undefined, page: undefined, size: undefined,
    });
  });

  it('keeps valid values', () => {
    expect(validateCertificateListSearch({ page: 4, size: 100, status: 'revoked' }))
      .toMatchObject({ page: 4, size: 100, status: 'revoked' });
  });
});
