export type BrowserContextMenuCommand =
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'paste-plain' | 'delete' | 'select-all'
  | 'ask-selection' | 'open-link' | 'copy-link' | 'ask-link' | 'copy-image' | 'copy-image-url'
  | 'back' | 'forward' | 'reload' | 'copy-page-url' | 'ask-page';

export interface BrowserContextMenuModelItem {
  command: BrowserContextMenuCommand;
  label: string;
  enabled: boolean;
  separatorBefore?: boolean;
}

export interface BrowserContextMenuInput {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  srcURL: string;
  hasImageContents: boolean;
  editFlags: {
    canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean;
    canPaste: boolean; canDelete: boolean; canSelectAll: boolean;
  };
  canGoBack: boolean;
  canGoForward: boolean;
}

export function buildBrowserContextMenuModel(input: BrowserContextMenuInput): BrowserContextMenuModelItem[] {
  const items: BrowserContextMenuModelItem[] = [];
  const push = (item: BrowserContextMenuModelItem) => items.push({ ...item, separatorBefore: item.separatorBefore && items.length > 0 });
  if (input.isEditable) {
    push({ command: 'undo', label: 'Undo', enabled: input.editFlags.canUndo });
    push({ command: 'redo', label: 'Redo', enabled: input.editFlags.canRedo });
    push({ command: 'cut', label: 'Cut', enabled: input.editFlags.canCut, separatorBefore: true });
    push({ command: 'copy', label: 'Copy', enabled: input.editFlags.canCopy });
    push({ command: 'paste', label: 'Paste', enabled: input.editFlags.canPaste });
    push({ command: 'paste-plain', label: 'Paste as plain text', enabled: input.editFlags.canPaste });
    push({ command: 'delete', label: 'Delete', enabled: input.editFlags.canDelete });
    push({ command: 'select-all', label: 'Select all', enabled: input.editFlags.canSelectAll });
  } else if (input.selectionText) {
    push({ command: 'copy', label: 'Copy', enabled: input.editFlags.canCopy });
    push({ command: 'ask-selection', label: 'Ask Agent about selection', enabled: true });
  }
  if (input.linkURL) {
    push({ command: 'open-link', label: 'Open link in new Hexestra tab', enabled: true, separatorBefore: true });
    push({ command: 'copy-link', label: 'Copy link address', enabled: true });
    push({ command: 'ask-link', label: 'Ask Agent about link', enabled: true });
  }
  if (input.hasImageContents || input.srcURL) {
    push({ command: 'copy-image', label: 'Copy image', enabled: input.hasImageContents, separatorBefore: true });
    push({ command: 'copy-image-url', label: 'Copy image address', enabled: !!input.srcURL });
  }
  push({ command: 'back', label: 'Back', enabled: input.canGoBack, separatorBefore: true });
  push({ command: 'forward', label: 'Forward', enabled: input.canGoForward });
  push({ command: 'reload', label: 'Reload', enabled: true });
  push({ command: 'copy-page-url', label: 'Copy page address', enabled: true });
  push({ command: 'ask-page', label: 'Ask Agent about this page', enabled: true });
  return items;
}
