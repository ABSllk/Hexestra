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
    <div className="flex h-7 shrink-0 select-none items-center border-t border-border-subtle bg-canvas px-3 text-[11px] text-text-muted">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {session && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span><span className="text-text-secondary">{targetCount + assetCount}</span> {t('status.assets')}</span>
            <span className="text-border-strong">·</span>
            <span><span className="text-text-secondary">{session.findingCount}</span> {t('status.findings')}</span>
            <span className="text-border-strong">·</span>
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
            'flex min-h-7 items-center gap-1.5 rounded-md border px-2',
            isNetMapVisible
              ? 'border-accent-teal/20 bg-accent-teal/10 text-accent-teal hover:border-accent-teal/40'
              : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-raised hover:text-text-secondary',
          )}
        >
          <Icon name="network" size={11} />
          <span>{language === 'zh-CN' ? 'NetMap' : 'NetMap'}: {isNetMapVisible ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  );
}
