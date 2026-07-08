/**
 * Zero-dependency toast notifications, themed with the app's Tailwind tokens
 * (bg-popover / border / text-*-foreground) so they match light & dark mode.
 * Replaces native window.alert(). Mount <ToastProvider> once near the root and
 * call const toast = useToast(); toast.error(msg) / toast.success(msg).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: ReactNode;
  variant: ToastVariant;
}

interface ToastOptions {
  /** Milliseconds before auto-dismiss; 0 disables auto-dismiss. */
  duration?: number;
}

interface ToastApi {
  toast: (message: ReactNode, variant?: ToastVariant, opts?: ToastOptions) => void;
  success: (message: ReactNode, opts?: ToastOptions) => void;
  error: (message: ReactNode, opts?: ToastOptions) => void;
  info: (message: ReactNode, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const VARIANT_META: Record<ToastVariant, { Icon: typeof Info; accent: string }> = {
  success: { Icon: CheckCircle2, accent: 'text-green-600 dark:text-green-400' },
  error: { Icon: AlertCircle, accent: 'text-destructive' },
  info: { Icon: Info, accent: 'text-primary' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: ReactNode, variant: ToastVariant = 'info', opts?: ToastOptions) => {
      const id = (idRef.current += 1);
      setItems((list) => [...list, { id, message, variant }]);
      const duration = opts?.duration ?? (variant === 'error' ? 6000 : 4000);
      if (duration > 0) setTimeout(() => remove(id), duration);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (m, o) => push(m, 'success', o),
      error: (m, o) => push(m, 'error', o),
      info: (m, o) => push(m, 'info', o),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="fixed top-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2"
          role="region"
          aria-label="Notifications"
        >
          {items.map((t) => (
            <ToastRow key={t.id} item={t} onClose={() => remove(t.id)} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastRow({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const { Icon, accent } = VARIANT_META[item.variant];
  return (
    <div
      role="alert"
      className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${accent}`} />
      <div className="flex-1 whitespace-pre-line break-words leading-snug">{item.message}</div>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
