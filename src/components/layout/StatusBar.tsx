import { useAppStore, useSessionStore } from '@/stores';
import { Icon } from '@/components/shared/Icon';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';

export function StatusBar() {
  const { t, language } = useI18n();
  const session = useSessionStore((s) => s.currentSession);
  const targetCount = useSessionStore((s) => s.targets.length);
  const assetCount = useSessionStore((s) => s.assets.length);
  const isNetMapVisible = useAppStore((s) => s.isNetMapVisible);
  const toggleNetMap = useAppStore((s) => s.toggleNetMap);

  return (
    <div className="flex h-6 shrink-0 select-none items-center border-t border-surface bg-bg-tertiary/95 px-2.5 text-2xs text-text-muted">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {session && (
          <div className="flex items-center gap-2 font-mono text-[9px]">
            <span><span className="text-text-secondary">{targetCount + assetCount}</span> {t('status.assets')}</span>
            <span className="text-surface-active">·</span>
            <span><span className="text-text-secondary">{session.findingCount}</span> {t('status.findings')}</span>
            <span className="text-surface-active">·</span>
            <span><span className="text-text-secondary">{session.vulnerabilityCount}</span> {t('status.vulnerabilities')}</span>
          </div>
        )}
      </div>
      <div className="shrink-0">
        <button
          type="button"
          aria-label={isNetMapVisible ? t('status.hideNetMap') : t('status.showNetMap')}
          aria-pressed={isNetMapVisible}
          onClick={toggleNetMap}
          className={cn(
            'flex h-5 items-center gap-1 rounded-md border px-1.5',
            isNetMapVisible
              ? 'border-transparent text-text-muted hover:border-surface hover:bg-surface/35 hover:text-text-secondary'
              : 'border-accent-teal/20 bg-accent-teal/10 text-accent-teal hover:border-accent-teal/40',
          )}
        >
          <Icon name="network" size={11} />
          <span>{language === 'zh-CN' ? '网络图' : 'NetMap'}: {isNetMapVisible ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  );
}
