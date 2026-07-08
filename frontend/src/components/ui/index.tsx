/**
 * App-wide UI feedback providers: themed toasts + confirm/prompt dialogs that
 * replace the native window.alert/confirm/prompt pop-ups. Mount <UiProvider>
 * once near the root; use via useToast() and useConfirm().
 */
import type { ReactNode } from 'react';
import { ToastProvider } from './toast';
import { ConfirmProvider } from './confirm-dialog';

export { useToast } from './toast';
export { useConfirm } from './confirm-dialog';
export type { ConfirmOptions, ConfirmResult } from './confirm-dialog';

export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
