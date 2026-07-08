/**
 * Small themed search/filter input with a magnifier icon and a clear button.
 * Controlled — pass value + onChange and filter your list client-side.
 */
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
  ariaLabel,
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="searchbox"
        aria-label={ariaLabel ?? placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background py-1.5 pl-8 pr-8 text-sm"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
