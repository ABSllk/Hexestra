export const DIALOG_IPC = {
  CONFIRM: 'dialog:confirm',
  RESPOND: 'dialog:respond',
  REQUESTED: 'dialog:requested',
} as const;

export type ConfirmDialogTone = 'default' | 'danger' | 'trust';

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  details?: string;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
}

export interface ConfirmDialogRequest extends ConfirmDialogOptions {
  id: string;
}

export interface ConfirmDialogResponse {
  id: string;
  confirmed: boolean;
}
