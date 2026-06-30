import type { ReactNode } from 'react';
import { ConfigSnippet, type ConfigSnippetProps } from './ConfigSnippet';

export interface DeployPanelProps {
  /** Panel heading. */
  title?: string;
  /** Optional helper text under the heading. */
  description?: string;
  /** Snippets to stack vertically. */
  snippets?: ConfigSnippetProps[];
  /** Custom children rendered after the snippets (e.g. an editable pattern row). */
  children?: ReactNode;
}

/**
 * A deployment instructions panel: a titled card with stacked ConfigSnippets.
 * Used on the SSH CA / host / user detail pages to surface keys and config drop-ins.
 */
export function DeployPanel({ title = 'Deploy', description, snippets, children }: DeployPanelProps) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="font-medium">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      <div className="p-4 space-y-5">
        {snippets?.map((s, i) => (
          <ConfigSnippet key={s.title ?? i} {...s} />
        ))}
        {children}
      </div>
    </div>
  );
}
