import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { DIALOG_IPC, type ConfirmDialogOptions } from '@electron/contracts/dialog';
import { useI18n } from '@/i18n';

export type { ConfirmDialogOptions } from '@electron/contracts/dialog';

type ConfirmDialogRequest = (options: ConfirmDialogOptions) => Promise<boolean>;
const ConfirmDialogContext = createContext<ConfirmDialogRequest>(async () => false);

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const confirm = useCallback<ConfirmDialogRequest>((options) => window.hexestra.invoke<boolean>(DIALOG_IPC.CONFIRM, {
    eyebrow: t('dialog.confirmation'),
    cancelLabel: t('common.cancel'),
    confirmLabel: t('common.confirm'),
    ...options,
  }), [t]);
  return <ConfirmDialogContext.Provider value={confirm}>{children}</ConfirmDialogContext.Provider>;
}
