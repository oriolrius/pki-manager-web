import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

/**
 * SSH Zones (decision-017 §8): a persisted zone switcher shared by the whole SSH
 * section. The selection is the zone SLUG (or the sentinel 'all' = All zones) and
 * survives a reload through BOTH the URL search param `?zone=` (so a copied link
 * opens on the same zone) and localStorage (so it sticks when a sub-nav Link
 * drops the param). URL wins on load; localStorage is the fallback.
 */

export type ZoneSelection = 'all' | string; // 'all' | <slug>

export interface SshZoneDto {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface ZoneContextValue {
  /** 'all' or the selected zone's slug. */
  selection: ZoneSelection;
  setSelection: (value: ZoneSelection) => void;
  /** true when "All zones" is selected. */
  isAll: boolean;
  /** Active zones only — for the switcher and the create-form pickers. */
  zones: SshZoneDto[];
  /** All zones incl. archived — for mapping a row's zoneId to a name. */
  allZones: SshZoneDto[];
  /** The resolved zone id when a specific zone is selected, else undefined. */
  zoneId: string | undefined;
  /** The selected zone's display name, else undefined. */
  zoneName: string | undefined;
  /** Map any zone id (incl. archived) to its slug for a Zone column. */
  zoneNameById: (id: string | null | undefined) => string;
}

const STORAGE_KEY = 'ssh.selectedZone';
const ZoneContext = createContext<ZoneContextValue | null>(null);

function readStored(): ZoneSelection {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

export function ZoneProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { zone?: string };
  const urlZone = typeof search.zone === 'string' && search.zone ? search.zone : undefined;

  const activeQuery = trpc.ssh.zone.list.useQuery({ includeArchived: false });
  const allQuery = trpc.ssh.zone.list.useQuery({ includeArchived: true });
  const zones = (activeQuery.data ?? []) as SshZoneDto[];
  const allZones = (allQuery.data ?? []) as SshZoneDto[];

  // URL wins on first load; else localStorage; else All zones.
  const selection: ZoneSelection = urlZone ?? readStored();

  const setSelection = (value: ZoneSelection) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* private mode: URL still carries it */
    }
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, zone: value === 'all' ? undefined : value }),
      replace: true,
    });
  };

  // Keep the URL in sync with the effective selection (e.g. when a sub-nav Link
  // dropped the param but localStorage still holds a zone). Runs only when they
  // diverge, so there is no navigate loop.
  useEffect(() => {
    const desired = selection === 'all' ? undefined : selection;
    if (urlZone !== desired) {
      navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, zone: desired }),
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, urlZone]);

  const value = useMemo<ZoneContextValue>(() => {
    const active = selection !== 'all' ? zones.find((z) => z.name === selection) : undefined;
    const byId = new Map(allZones.map((z) => [z.id, z.name] as const));
    return {
      selection,
      setSelection,
      isAll: selection === 'all',
      zones,
      allZones,
      zoneId: active?.id,
      zoneName: active?.displayName,
      zoneNameById: (id) => (id ? byId.get(id) ?? id : '—'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, zones, allZones]);

  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
}

export function useZone(): ZoneContextValue {
  const ctx = useContext(ZoneContext);
  if (!ctx) throw new Error('useZone must be used within a ZoneProvider');
  return ctx;
}
