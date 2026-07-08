/**
 * Zero-dependency confirm / prompt dialog, themed with the app's Tailwind tokens
 * so it matches light & dark mode. Replaces native window.confirm() and
 * window.prompt(). Mount <ConfirmProvider> once near the root and call
 * const confirm = useConfirm(); const { confirmed, reason } = await confirm({...}).
 *
 * Supports an optional `reason` field to cover the old prompt() call sites in one
 * dialog (confirm + capture text together).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Render a reason input; the entered text comes back on the result. */
  reason?: { label?: string; placeholder?: string; required?: boolean };
}

export interface ConfirmResult {
  confirmed: boolean;
  reason?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}

interface PendingState {
  opts: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [reason, setReason] = useState('');

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason('');
        setPending({ opts, resolve });
      }),
    []
  );

  const settle = useCallback((result: ConfirmResult) => {
    setPending((cur) => {
      cur?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending &&
        createPortal(
          <ConfirmModal
            opts={pending.opts}
            reason={reason}
            setReason={setReason}
            onCancel={() => settle({ confirmed: false })}
            onConfirm={() => settle({ confirmed: true, reason: reason.trim() || undefined })}
          />,
          document.body
        )}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  opts,
  reason,
  setReason,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const danger = opts.tone === 'danger';
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus the reason field if present, otherwise the (safe) Cancel button.
    (opts.reason ? reasonRef.current : cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opts, onCancel]);

  const canConfirm = !opts.reason?.required || reason.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={opts.title ?? 'Confirm action'}
    >
      <div className="animate-fade-in absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="animate-dialog-in relative z-10 w-full max-w-md rounded-lg border bg-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          {danger && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {opts.title && <h3 className="text-base font-semibold">{opts.title}</h3>}
            {opts.description && (
              <div className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                {opts.description}
              </div>
            )}
            {opts.reason && (
              <div className="mt-3">
                {opts.reason.label && (
                  <label className="mb-1 block text-xs font-medium">{opts.reason.label}</label>
                )}
                <textarea
                  ref={reasonRef}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder={opts.reason.placeholder}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              danger
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {opts.confirmLabel ?? (danger ? 'Confirm' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
