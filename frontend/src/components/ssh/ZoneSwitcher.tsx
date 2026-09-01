import { Layers } from 'lucide-react';
import { useZone } from '@/lib/zone-context';

/**
 * The SSH-section zone switcher (decision-017 §8). Lists active zones plus an
 * explicit "All zones" option; the selection is persisted (URL + localStorage)
 * by the ZoneProvider.
 */
export function ZoneSwitcher() {
  const { selection, setSelection, zones } = useZone();

  return (
    <label className="flex w-full items-center justify-between gap-2 text-sm sm:w-auto sm:justify-start" title="Filter the SSH section by zone">
      <Layers className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">Zone</span>
      <select
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
        className="px-3 py-1.5 border rounded-md bg-background text-sm min-w-[10rem]"
        data-testid="zone-switcher"
      >
        <option value="all">All zones</option>
        {zones.map((z) => (
          <option key={z.id} value={z.name}>
            {z.displayName} ({z.name})
          </option>
        ))}
      </select>
    </label>
  );
}
