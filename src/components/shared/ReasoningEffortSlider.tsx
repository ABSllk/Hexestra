import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AgentReasoningEffort } from '@electron/contracts/agent-runtime';
import { useI18n } from '@/i18n';

interface ReasoningEffortSliderProps {
  value: AgentReasoningEffort | null;
  efforts: AgentReasoningEffort[];
  defaultEffort?: AgentReasoningEffort | null;
  descriptions?: Partial<Record<AgentReasoningEffort, string>>;
  disabled?: boolean;
  onCommit: (effort: AgentReasoningEffort | null) => void | boolean | Promise<void | boolean>;
}

export function ReasoningEffortSlider({
  value, efforts, defaultEffort, descriptions, disabled = false, onCommit,
}: ReasoningEffortSliderProps) {
  const { t } = useI18n();
  const defaultIndex = Math.max(0, efforts.indexOf(defaultEffort ?? 'medium'));
  const selectedIndex = value === null ? defaultIndex : Math.max(0, efforts.indexOf(value));
  const [previewIndex, setPreviewIndex] = useState(selectedIndex);
  const [saving, setSaving] = useState(false);
  const previewRef = useRef(selectedIndex);
  const savingRef = useRef(false);

  useEffect(() => {
    previewRef.current = selectedIndex;
    setPreviewIndex(selectedIndex);
  }, [selectedIndex, efforts]);

  const previewEffort = efforts[previewIndex];
  const showingDefault = value === null && previewIndex === defaultIndex;
  const previewLabel = showingDefault
    ? defaultEffort && efforts.includes(defaultEffort)
      ? `${t('agent.effort.default')} · ${t(`agent.effort.${defaultEffort}`)}`
      : t('agent.effort.default')
    : previewEffort ? t(`agent.effort.${previewEffort}`) : t('agent.effort.default');
  const unavailable = disabled || saving || efforts.length === 0;

  const commit = async () => {
    const effort = efforts[previewRef.current];
    if (unavailable || savingRef.current || !effort || (value !== null && effort === value) || (value === null && previewRef.current === defaultIndex)) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await onCommit(effort);
      if (result === false) {
        previewRef.current = selectedIndex;
        setPreviewIndex(selectedIndex);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const updatePreview = (index: number) => {
    previewRef.current = index;
    setPreviewIndex(index);
  };

  const reset = async () => {
    if (unavailable || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onCommit(null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <div className="min-w-0">
    <div className="mb-1 flex min-h-5 items-center justify-between gap-2 text-[11px]">
      <span className="truncate font-medium text-text-primary" title={previewEffort ? descriptions?.[previewEffort] : undefined}>{previewLabel}</span>
      {value !== null && <button type="button" disabled={unavailable} onClick={() => void reset()}
        className="shrink-0 rounded px-1 text-text-muted transition-colors hover:text-accent-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-40">
        {t('agent.effort.reset')}
      </button>}
    </div>
    <input type="range" className="agent-effort-range" aria-label={t('agent.effort')}
      aria-valuetext={previewLabel} title={previewEffort ? descriptions?.[previewEffort] : previewLabel}
      min={0} max={Math.max(0, efforts.length - 1)} step={1} value={previewIndex} disabled={unavailable}
      style={{ '--effort-progress': `${efforts.length > 1 ? previewIndex / (efforts.length - 1) * 100 : 0}%` } as CSSProperties}
      onChange={(event) => updatePreview(Number(event.currentTarget.value))}
      onPointerUp={() => { if (!savingRef.current) void commit(); }}
      onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void commit(); }} />
    {efforts.length > 1 && <div className="flex justify-between text-[10px] leading-4 text-text-muted" aria-hidden="true">
      <span>{t(`agent.effort.${efforts[0]}`)}</span>
      <span>{t(`agent.effort.${efforts[efforts.length - 1]}`)}</span>
    </div>}
  </div>;
}
