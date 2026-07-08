/**
 * Zero-dependency select with a search box INSIDE the dropdown, themed with the
 * app's Tailwind tokens. A filterable replacement for a native <select> when the
 * option list is long: click the trigger, type in the search field at the top of
 * the menu to filter, pick an option. Controlled: pass value + onChange.
 *
 *   <Combobox options={hosts.map(h => ({ value: h.id, label: h.fqdn }))}
 *             value={hostId} onChange={setHostId}
 *             placeholder="Select host…" searchPlaceholder="Search hosts…" />
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Search, Check } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  disabled,
  className = '',
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  // Reset + focus the search field each time the menu opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [q, options]
  );

  const select = (opt: ComboboxOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (filtered[activeIndex]) {
        e.preventDefault();
        select(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
      >
        <span className={selected ? 'truncate' : 'truncate text-muted-foreground'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && !disabled && (
        <div className="animate-fade-in absolute z-50 mt-1 w-full min-w-[12rem] rounded-md border bg-popover shadow-lg">
          <div className="border-b p-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                className="w-full rounded-md border bg-background py-1 pl-7 pr-2 text-xs"
              />
            </div>
          </div>
          <ul role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-auto py-1 text-xs">
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-muted-foreground">{emptyText}</li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(opt);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 ${
                    i === activeIndex ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <span className={`truncate ${opt.value === value ? 'font-medium' : ''}`}>{opt.label}</span>
                  {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
