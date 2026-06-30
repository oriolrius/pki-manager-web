import type { ReactNode } from 'react';
import { Info, AlertTriangle } from 'lucide-react';

export type CalloutTone = 'info' | 'warn';

/**
 * Small inline note used across the SSH pages to teach the concepts that bite
 * first-time users: the two trust directions, the principal-in-two-places rule,
 * and the honest "this only updates PKI Manager — nothing is pushed" caveats.
 */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  const Icon = tone === 'warn' ? AlertTriangle : Info;
  const cls =
    tone === 'warn'
      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200';
  return (
    <div className={`flex gap-2.5 rounded-md border p-3 text-xs ${cls}`}>
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div className="space-y-1">
        {title && <div className="font-medium">{title}</div>}
        <div className="opacity-90">{children}</div>
      </div>
    </div>
  );
}
