import { useEffect } from 'react';
import { useZone } from '@/lib/zone-context';

/**
 * Zone <select> for create forms (decision-017 §8): lists ACTIVE zones only
 * (archived zones are never offered), value is the zone id. Prefills from the
 * section switcher (the selected zone, else the first active zone) by calling
 * onChange once when the parent's value is empty.
 */
export function ZonePicker({
  value,
  onChange,
  id = 'zone',
  className = 'w-full px-3 py-2 border rounded-md bg-background',
}: {
  value: string;
  onChange: (zoneId: string) => void;
  id?: string;
  className?: string;
}) {
  const { zones, zoneId } = useZone();
  const fallback = zoneId ?? zones[0]?.id ?? '';
  const effective = value || fallback;

  useEffect(() => {
    if (!value && fallback) onChange(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  return (
    <select id={id} value={effective} onChange={(e) => onChange(e.target.value)} className={className} required>
      {zones.length === 0 && <option value="">No active zones — create one first</option>}
      {zones.map((z) => (
        <option key={z.id} value={z.id}>
          {z.displayName} ({z.name})
        </option>
      ))}
    </select>
  );
}
