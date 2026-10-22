import { useState } from 'react';
import { generateExportPassword } from '@/lib/export-password';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  id?: string;
  label?: string;
}

export function ExportPasswordField({ value, onChange, id = 'export-password', label = 'Export password' }: Props) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [error, setError] = useState('');
  const update = (password: string) => {
    setCopiedValue(null);
    setError('');
    onChange?.(password);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setError('');
    } catch {
      setError('Could not copy the password. Select and copy it manually.');
    }
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="text" value={value} readOnly={!onChange}
          onChange={(event) => update(event.target.value)}
          autoComplete="off" spellCheck={false} minLength={8}
          className="min-w-64 flex-1 px-3 py-2 text-sm font-mono border rounded-md bg-background" />
        <button type="button" onClick={() => void copy()} disabled={!value}
          className="px-3 py-2 text-sm border rounded-md hover:bg-muted disabled:opacity-50">
          {copiedValue === value ? 'Copied!' : 'Copy password'}
        </button>
        {onChange && <button type="button" onClick={() => update(generateExportPassword())}
          className="px-3 py-2 text-sm border rounded-md hover:bg-muted">Generate new password</button>}
      </div>
      <p className="text-xs text-muted-foreground">Save this password with the downloaded file. It is not stored for later retrieval.</p>
      {onChange && value.length < 8 && <p role="alert" className="text-xs text-destructive">Use at least 8 characters.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
