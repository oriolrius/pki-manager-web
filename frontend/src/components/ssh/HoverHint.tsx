import { type ReactNode } from 'react';

/**
 * Wraps a control and reveals a short explanatory hint BELOW it on hover/focus —
 * a richer, styled replacement for the native `title` tooltip (which callers drop
 * to avoid showing two). Pure CSS (group-hover/group-focus-within) so there is no
 * per-instance state. `align` controls which edge the panel is anchored to, to
 * keep it from overflowing the viewport for left- vs right-placed toolbars.
 */
export function HoverHint({
  hint,
  children,
  align = 'left',
  width = 'w-64',
}: {
  hint: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1 hidden ${width} rounded-md border bg-popover p-2 text-xs font-normal normal-case leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-within:block ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {hint}
      </span>
    </span>
  );
}
