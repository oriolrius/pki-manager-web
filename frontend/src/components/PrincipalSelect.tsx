import { useRef, useState } from 'react';
import { X, ChevronDown, HelpCircle } from 'lucide-react';

export interface PrincipalOption {
  name: string;
  description?: string | null;
}

export interface PrincipalSelectProps {
  label?: string;
  /** The principal catalog to offer. Passed in so this component stays free of data fetching. */
  options: PrincipalOption[];
  value: string[];
  onChange: (principals: string[]) => void;
  help?: string;
}

/**
 * Multi-select for certificate principals: pick from the catalog with type-to-filter,
 * or type a name that isn't in the catalog (certs may legitimately carry a principal
 * that has not been mapped yet) — off-catalog picks are marked so a typo stands out.
 */
export function PrincipalSelect({ label, options, value, onChange, help }: PrincipalSelectProps) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const catalog = new Set(options.map((o) => o.name));
  const query = draft.trim().toLowerCase();
  const matches = options.filter(
    (o) => !value.includes(o.name) && (!query || o.name.toLowerCase().includes(query))
  );
  const exactInCatalog = options.some((o) => o.name.toLowerCase() === query);

  const add = (name: string) => {
    const v = name.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      // Enter takes the single visible match, so a filtered pick needs no mouse.
      if (matches.length === 1 && query) add(matches[0].name);
      else add(draft);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      {label && <label className="block text-sm font-medium mb-2">{label}</label>}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((p) => {
            const known = catalog.has(p);
            return (
              <span
                key={p}
                title={known ? undefined : 'Not in the principal catalog — check for a typo'}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono ${
                  known
                    ? 'bg-primary/10 text-primary'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-400/60 border-dashed'
                }`}
              >
                {!known && <HelpCircle className="h-3 w-3" aria-label="Not in catalog" />}
                {p}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== p))}
                  aria-label={`Remove ${p}`}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="principal-options"
          aria-autocomplete="list"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Deferred so a click on an option lands before the list unmounts.
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder={options.length ? 'Search principals…' : 'e.g. admins'}
          className="w-full px-3 py-2 pr-8 border rounded-md bg-background text-sm"
        />
        <ChevronDown className="h-4 w-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />

        {open && (
          <ul
            id="principal-options"
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-card shadow-md"
            onMouseDown={() => clearTimeout(blurTimer.current)}
          >
            {matches.map((o) => (
              <li key={o.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add(o.name)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 text-sm"
                >
                  <span className="font-mono">{o.name}</span>
                  {o.description && <span className="text-xs text-muted-foreground ml-2">{o.description}</span>}
                </button>
              </li>
            ))}

            {query && !exactInCatalog && !value.includes(draft.trim()) && (
              <li>
                <button
                  type="button"
                  onClick={() => add(draft)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 text-sm border-t"
                >
                  Use “<span className="font-mono">{draft.trim()}</span>” — not in the catalog
                </button>
              </li>
            )}

            {matches.length === 0 && !query && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {options.length === 0 ? 'No principals in the catalog yet.' : 'All catalog principals selected.'}
              </li>
            )}
          </ul>
        )}
      </div>

      {help && <p className="text-xs text-muted-foreground mt-1">{help}</p>}
    </div>
  );
}
