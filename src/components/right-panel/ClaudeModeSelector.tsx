import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/cn';
import type { AgentPermissionMode } from '@/types';

export const CLAUDE_MODE_OPTIONS: ReadonlyArray<{
  value: AgentPermissionMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  {
    value: 'default',
    labelKey: 'agent.permissionMode.default',
    descriptionKey: 'agent.permissionModeHint.default',
  },
  {
    value: 'auto',
    labelKey: 'agent.permissionMode.auto',
    descriptionKey: 'agent.permissionModeHint.auto',
  },
  {
    value: 'bypassPermissions',
    labelKey: 'agent.permissionMode.bypassPermissions',
    descriptionKey: 'agent.permissionModeHint.bypassPermissions',
  },
];

export function ClaudeModeSelector({
  value,
  onChange,
  isProcessing,
}: {
  value: AgentPermissionMode;
  onChange: (mode: AgentPermissionMode) => void;
  isProcessing: boolean;
}) {
  const { t } = useI18n();
  const [confirmingBypass, setConfirmingBypass] = useState(false);

  const selectMode = (mode: AgentPermissionMode) => {
    if (mode === 'bypassPermissions' && value !== 'bypassPermissions') {
      setConfirmingBypass(true);
      return;
    }
    setConfirmingBypass(false);
    onChange(mode);
  };

  return (
    <div>
      <p className="px-2 pb-1 text-[11px] leading-4 text-text-muted">{t('agent.permissionModeHint')}</p>
      {CLAUDE_MODE_OPTIONS.map((mode) => {
        const selected = value === mode.value;
        const danger = mode.value === 'bypassPermissions';
        return (
          <button
            key={mode.value}
            type="button"
            aria-label={t(mode.labelKey)}
            aria-pressed={selected}
            onClick={() => selectMode(mode.value)}
            className={cn(
              'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised/50',
              selected
                ? danger ? 'bg-severity-critical/10 text-severity-critical' : 'bg-accent-blue/10 text-accent-blue'
                : danger ? 'text-severity-critical' : 'text-text-secondary',
            )}
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-medium">{t(mode.labelKey)}</span>
              <span className="block text-[11px] leading-4 text-text-muted">{t(mode.descriptionKey)}</span>
            </span>
            {selected && <Icon name="check" size={12} className="shrink-0" />}
          </button>
        );
      })}
      {isProcessing && <p className="mt-1 border-t border-border-subtle px-2 pt-2 text-[11px] text-text-muted">{t('agent.permissionModeNextRequest')}</p>}
      {confirmingBypass && (
        <div
          className="mt-2 border-t border-border-subtle px-2 pt-2"
          role="alert"
        >
          <div className="flex gap-1.5 text-[11px] leading-4 text-severity-critical">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{t('agent.permissionModeBypassWarning')}</span>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmingBypass(false)}
              className="ui-button ui-button-neutral"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingBypass(false);
                onChange('bypassPermissions');
              }}
              className="ui-button ui-button-danger"
            >
              {t('agent.permissionModeEnableBypass')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
