import { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { highlightCode, type CodeLanguage } from '@/lib/highlight';

export interface ConfigSnippetProps {
  /** Heading shown above the block. */
  title?: string;
  /** Optional helper text under the title. */
  description?: string;
  /** The monospace contents. */
  content: string;
  /** When set, a download button writes the content to this filename. */
  downloadFilename?: string;
  /** Optional language/format hint chip (e.g. "sshd_config"). */
  badge?: string;
  /** Marks the block required/optional with a coloured pill + accent stripe. */
  requirement?: 'required' | 'optional';
  /** Enables lightweight syntax highlighting of the block contents. */
  language?: CodeLanguage;
}

/**
 * Titled monospace config block with a copy button (transient Copy/Check state)
 * and an optional "download as file" button. Used across the SSH deploy panels.
 */
const REQUIREMENT_PILL: Record<'required' | 'optional', string> = {
  required: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  optional: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};
const REQUIREMENT_ACCENT: Record<'required' | 'optional', string> = {
  required: 'border-l-4 border-l-emerald-500/70',
  optional: 'border-l-4 border-l-amber-500/60',
};

export function ConfigSnippet({
  title,
  description,
  content,
  downloadFilename,
  badge,
  requirement,
  language,
}: ConfigSnippetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename ?? 'snippet.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-1.5">
      {(title || description) && (
        <div className="flex items-baseline justify-between gap-2">
          <div>
            {title && (
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">{title}</h4>
                {requirement && (
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${REQUIREMENT_PILL[requirement]}`}
                  >
                    {requirement}
                  </span>
                )}
                {badge && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {badge}
                  </span>
                )}
              </div>
            )}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </div>
      )}
      <div className="relative group">
        <pre
          className={`text-xs font-mono bg-muted/50 border rounded-md p-3 pr-20 overflow-x-auto whitespace-pre-wrap break-all ${
            requirement ? REQUIREMENT_ACCENT[requirement] : ''
          }`}
        >
          <code>{language ? highlightCode(content, language) : content}</code>
        </pre>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {downloadFilename && (
            <button
              type="button"
              onClick={handleDownload}
              title={`Download ${downloadFilename}`}
              aria-label={`Download ${downloadFilename}`}
              className="p-1.5 rounded border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
            className="p-1.5 rounded border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
