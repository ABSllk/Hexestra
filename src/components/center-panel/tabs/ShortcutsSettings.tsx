import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  SHORTCUT_COMMANDS,
  reservedShortcutReason,
  resolveShortcutBinding,
  shortcutBindingFromEvent,
  shortcutCollisionKey,
  shortcutDisplayTokens,
  type ShortcutCategory,
  type ShortcutCommandId,
} from '@electron/contracts/shortcuts';
import { DismissibleNotice, Icon } from '@/components/shared';
import { useAppPreferences, useI18n, type TranslationKey } from '@/i18n';

const CATEGORY_ORDER: ShortcutCategory[] = ['general', 'workspace', 'view', 'editor', 'terminal'];
const CATEGORY_LABELS: Record<ShortcutCategory, TranslationKey> = {
  general: 'shortcuts.category.general',
  workspace: 'shortcuts.category.workspace',
  view: 'shortcuts.category.view',
  editor: 'shortcuts.category.editor',
  terminal: 'shortcuts.category.terminal',
};
const COMMAND_LABELS: Record<ShortcutCommandId, TranslationKey> = {
  'presentation.toggle': 'shortcuts.command.presentationToggle',
  'project.openFolder': 'shortcuts.command.openFolder',
  'project.createFolder': 'shortcuts.command.createFolder',
  'workspace.newTerminal': 'shortcuts.command.newTerminal',
  'workspace.openBrowser': 'shortcuts.command.openBrowser',
  'settings.open': 'shortcuts.command.openSettings',
  'tabs.closeActive': 'shortcuts.command.closeTab',
  'tabs.next': 'shortcuts.command.nextTab',
  'tabs.previous': 'shortcuts.command.previousTab',
  'view.toggleNetMap': 'shortcuts.command.toggleNetMap',
  'view.openTraffic': 'shortcuts.command.openTraffic',
  'editor.save': 'shortcuts.command.saveFile',
  'terminal.copy': 'shortcuts.command.terminalCopy',
  'terminal.paste': 'shortcuts.command.terminalPaste',
};

export function ShortcutsSettings() {
  const { t } = useI18n();
  const { settings, platform, setShortcutOverride, resetShortcutOverrides } = useAppPreferences();
  const [recordingId, setRecordingId] = useState<ShortcutCommandId | null>(null);
  const [busyId, setBusyId] = useState<ShortcutCommandId | 'all' | null>(null);
  const [rowError, setRowError] = useState<{ id: ShortcutCommandId; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    commands: SHORTCUT_COMMANDS.filter((command) => command.category === category),
  })), []);

  const saveBinding = async (id: ShortcutCommandId, binding: string | null | undefined) => {
    setBusyId(id);
    setError(null);
    try {
      await setShortcutOverride(id, binding);
      setRecordingId(null);
      setRowError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const record = (id: ShortcutCommandId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      setRecordingId(null);
      setRowError(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecordingId(null);
      setRowError(null);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      void saveBinding(id, null);
      return;
    }
    const binding = shortcutBindingFromEvent(event, platform);
    if (!binding) {
      if (!['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'].includes(event.key)) {
        setRowError({ id, message: t('shortcuts.modifierRequired') });
      }
      return;
    }
    if (reservedShortcutReason(binding, platform)) {
      setRowError({ id, message: t('shortcuts.reserved') });
      return;
    }
    const collision = shortcutCollisionKey(binding, platform);
    const conflict = SHORTCUT_COMMANDS.find((command) => (
      command.id !== id
        && resolveShortcutBinding(settings.shortcutOverrides, command.id)
        && shortcutCollisionKey(resolveShortcutBinding(settings.shortcutOverrides, command.id)!, platform) === collision
    ));
    if (conflict) {
      setRowError({
        id,
        message: t('shortcuts.conflict', { command: t(COMMAND_LABELS[conflict.id]) }),
      });
      return;
    }
    void saveBinding(id, binding);
  };

  const resetAll = async () => {
    setBusyId('all');
    setError(null);
    try {
      await resetShortcutOverrides();
      setRecordingId(null);
      setRowError(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-border-subtle pb-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{t('shortcuts.title')}</h1>
            <p className="max-w-2xl text-xs leading-5 text-text-muted">{t('shortcuts.description')}</p>
          </div>
          <button
            type="button"
            disabled={busyId !== null || Object.keys(settings.shortcutOverrides).length === 0}
            onClick={() => void resetAll()}
            className="ui-button ui-button-neutral shrink-0"
          >
            {t('shortcuts.resetAll')}
          </button>
        </header>

        {error && <DismissibleNotice tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}

        <div className="space-y-5">
          {grouped.map(({ category, commands }) => (
            <section key={category} aria-labelledby={`shortcut-category-${category}`}>
              <h2 id={`shortcut-category-${category}`} className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                {t(CATEGORY_LABELS[category])}
              </h2>
              <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel/45">
                {commands.map((command, index) => {
                  const binding = resolveShortcutBinding(settings.shortcutOverrides, command.id);
                  const tokens = shortcutDisplayTokens(binding, platform);
                  const customized = Object.prototype.hasOwnProperty.call(settings.shortcutOverrides, command.id);
                  const recording = recordingId === command.id;
                  return (
                    <div key={command.id} className={`${index ? 'border-t border-border-subtle' : ''} px-3 py-2.5`}>
                      <div className="flex min-h-9 items-center gap-3">
                        <span className="min-w-0 flex-1 text-xs font-medium text-text-secondary">{t(COMMAND_LABELS[command.id])}</span>
                        {customized && (
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => void saveBinding(command.id, undefined)}
                            className="rounded px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-raised hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          >
                            {t('shortcuts.resetOne')}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`${t(COMMAND_LABELS[command.id])}: ${tokens.join('+') || t('shortcuts.unassigned')}`}
                          aria-pressed={recording}
                          disabled={busyId !== null}
                          onClick={() => {
                            setRecordingId(command.id);
                            setRowError(null);
                          }}
                          onKeyDown={(event) => recording && record(command.id, event)}
                          onBlur={() => recording && setRecordingId(null)}
                          className={`flex min-h-8 min-w-36 items-center justify-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${recording ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-border-subtle bg-canvas text-text-secondary hover:border-border-strong hover:bg-raised'}`}
                        >
                          {recording ? (
                            <span>{t('shortcuts.pressShortcut')}</span>
                          ) : tokens.length ? tokens.map((token, tokenIndex) => (
                            <span key={`${token}-${tokenIndex}`} className="rounded border border-border-subtle bg-raised px-1.5 py-0.5 shadow-sm">{token}</span>
                          )) : (
                            <span className="text-text-muted">{t('shortcuts.unassigned')}</span>
                          )}
                        </button>
                      </div>
                      {rowError?.id === command.id && (
                        <p role="alert" className="mt-1 flex items-center justify-end gap-1 text-[11px] text-severity-critical">
                          <Icon name="alert" size={11} />{rowError.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
