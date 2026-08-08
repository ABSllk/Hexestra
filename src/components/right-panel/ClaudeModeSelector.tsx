import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import type { AgentPermissionMode } from '@/types';

export const CLAUDE_MODE_OPTIONS: ReadonlyArray<{
  value: AgentPermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: 'default',
    label: 'ASK',
    description: 'Ask before risky tool use',
  },
  {
    value: 'auto',
    label: 'AUTO',
    description: 'Classifier reviews actions in the background',
  },
  {
    value: 'bypassPermissions',
    label: 'BYPASS',
    description: 'All software permission checks are disabled',
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
  const [confirmingBypass, setConfirmingBypass] = useState(false);
  const activeMode = CLAUDE_MODE_OPTIONS.find((mode) => mode.value === value)!;

  const selectMode = (mode: AgentPermissionMode) => {
    if (mode === 'bypassPermissions' && value !== 'bypassPermissions') {
      setConfirmingBypass(true);
      return;
    }
    setConfirmingBypass(false);
    onChange(mode);
  };

  return (
    <div className="border-b border-border-subtle/50 bg-panel/30 px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Claude Mode
        </span>
        <div className="flex rounded border border-border-subtle bg-panel p-0.5" aria-label="Claude Code mode">
          {CLAUDE_MODE_OPTIONS.map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={value === mode.value}
              onClick={() => selectMode(mode.value)}
              className={
                value === mode.value && mode.value === 'bypassPermissions'
                  ? 'rounded bg-severity-critical/20 px-2 py-0.5 text-[11px] font-semibold text-severity-critical'
                  : value === mode.value
                  ? 'rounded bg-accent-teal/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-teal'
                  : 'rounded px-2 py-0.5 text-[11px] text-text-muted hover:bg-raised/40 hover:text-text-secondary'
              }
              title={`${mode.value}: ${mode.description}`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span className={value === 'bypassPermissions' ? 'truncate text-severity-critical' : 'truncate'}>
          {activeMode.description}
        </span>
        {isProcessing && <span className="shrink-0 text-accent-blue">NEXT REQUEST</span>}
      </div>
      {confirmingBypass && (
        <div
          className="mt-1.5 rounded border border-severity-critical/50 bg-severity-critical/10 p-2"
          role="alert"
        >
          <div className="flex gap-1.5 text-[11px] leading-4 text-text-secondary">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0 text-severity-critical" />
            <span>BYPASS allows commands and file changes without any permission prompt.</span>
          </div>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmingBypass(false)}
              className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingBypass(false);
                onChange('bypassPermissions');
              }}
              className="rounded border border-severity-critical/60 bg-severity-critical/15 px-2 py-0.5 text-[11px] font-semibold text-severity-critical hover:bg-severity-critical/25"
            >
              ENABLE BYPASS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
