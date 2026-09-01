/**
 * ZONE-11 (decision-017 §8) — the zone switcher context: default "All zones",
 * localStorage persistence, URL-param seeding, and slug→id resolution. The
 * router and tRPC hooks are mocked so the test stays a pure unit test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();
let searchValue: { zone?: string } = {};

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => searchValue,
}));

const ZONES = [
  { id: 'z-default', name: 'default', displayName: 'Default', description: null, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'z-prod', name: 'prod', displayName: 'Production', description: null, status: 'active', createdAt: '', updatedAt: '' },
  { id: 'z-old', name: 'old', displayName: 'Old', description: null, status: 'archived', createdAt: '', updatedAt: '' },
];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ssh: {
      zone: {
        list: {
          useQuery: (input: { includeArchived?: boolean }) => ({
            data: input?.includeArchived ? ZONES : ZONES.filter((z) => z.status === 'active'),
          }),
        },
      },
    },
  },
}));

import { ZoneProvider, useZone } from './zone-context';

function Probe() {
  const { selection, isAll, zoneId, zoneName, setSelection, zones, zoneNameById } = useZone();
  return (
    <div>
      <span data-testid="selection">{selection}</span>
      <span data-testid="isAll">{String(isAll)}</span>
      <span data-testid="zoneId">{zoneId ?? '—'}</span>
      <span data-testid="zoneName">{zoneName ?? '—'}</span>
      <span data-testid="activeCount">{zones.length}</span>
      <span data-testid="mapDefault">{zoneNameById('z-default')}</span>
      <button onClick={() => setSelection('prod')}>pick-prod</button>
    </div>
  );
}

const renderProbe = () => render(<ZoneProvider><Probe /></ZoneProvider>);

describe('ZoneProvider / useZone', () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockClear();
    searchValue = {};
  });

  it('defaults to All zones and offers only ACTIVE zones', () => {
    renderProbe();
    expect(screen.getByTestId('selection').textContent).toBe('all');
    expect(screen.getByTestId('isAll').textContent).toBe('true');
    expect(screen.getByTestId('zoneId').textContent).toBe('—');
    expect(screen.getByTestId('activeCount').textContent).toBe('2'); // archived 'old' excluded
  });

  it('resolves the selected slug to its zone id and persists to localStorage', () => {
    renderProbe();
    fireEvent.click(screen.getByText('pick-prod'));
    expect(localStorage.getItem('ssh.selectedZone')).toBe('prod');
    // navigate is asked to write ?zone=prod into the URL search
    expect(navigateMock).toHaveBeenCalled();
  });

  it('seeds the selection from the URL search param (a shared link opens on that zone)', () => {
    searchValue = { zone: 'prod' };
    renderProbe();
    expect(screen.getByTestId('selection').textContent).toBe('prod');
    expect(screen.getByTestId('zoneId').textContent).toBe('z-prod');
    expect(screen.getByTestId('zoneName').textContent).toBe('Production');
  });

  it('falls back to localStorage when the URL has no zone', () => {
    localStorage.setItem('ssh.selectedZone', 'prod');
    renderProbe();
    expect(screen.getByTestId('selection').textContent).toBe('prod');
    expect(screen.getByTestId('zoneId').textContent).toBe('z-prod');
  });

  it('maps any zone id (incl. archived) to its slug for the Zone column', () => {
    renderProbe();
    expect(screen.getByTestId('mapDefault').textContent).toBe('default');
  });
});
