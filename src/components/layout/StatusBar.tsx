import { useEffect } from 'react';
import { useAppStore, useEgressProxyStore, useSessionStore } from '@/stores';
import { Icon } from '@/components/shared/Icon';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { installEgressProxyEvents } from '@/stores/useEgressProxyStore';

const PROXY_STATE_STYLE = {
  off: {
    tone: 'text-text-muted',
    dot: 'bg-text-muted',
  },
  starting: {
    tone: 'text-status-warning',
    dot: 'bg-status-warning animate-pulse motion-reduce:animate-none',
  },
  ready: {
    tone: 'text-status-success',
    dot: 'bg-status-success',
  },
  degraded: {
    tone: 'text-status-warning',
    dot: 'bg-status-warning',
  },
  blocked: {
    tone: 'text-status-error',
    dot: 'bg-status-error',
  },
  error: {
    tone: 'text-status-error',
    dot: 'bg-status-error',
  },
} as const;

export function StatusBar() {
  const { t, language } = useI18n();
  const session = useSessionStore((s) => s.currentSession);
  const targetCount = useSessionStore((s) => s.targets.length);
  const assetCount = useSessionStore((s) => s.assets.length);
  const isNetMapVisible = useAppStore((s) => s.isNetMapVisible);
  const toggleNetMap = useAppStore((s) => s.toggleNetMap);
  const proxyStatus = useEgressProxyStore((s) => s.status);
  const proxyBusy = useEgressProxyStore((s) => s.busy);
  const loadProxy = useEgressProxyStore((s) => s.load);
  const setProxyEnabled = useEgressProxyStore((s) => s.setEnabled);

  useEffect(() => installEgressProxyEvents(), []);
  useEffect(() => {
    if (session?.id) void loadProxy(session.id).catch(() => undefined);
  }, [loadProxy, session?.id]);

  const proxyState = proxyStatus?.state ?? 'off';
  const proxyStyle = PROXY_STATE_STYLE[proxyState];
  const proxyEnabled = proxyStatus?.enabled === true;
  const proxyIp = proxyStatus?.exitIp ?? '—';
  const proxyLabel = language === 'zh-CN'
    ? `${proxyEnabled ? '代理' : '本机'}出口 ${proxyIp}，状态 ${proxyState.toUpperCase()}，点击${proxyEnabled ? '关闭' : '开启'}代理`
    : `${proxyEnabled ? 'Proxy' : 'Local'} exit ${proxyIp}, status ${proxyState.toUpperCase()}, click to turn proxy ${proxyEnabled ? 'off' : 'on'}`;

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
      <div className="flex shrink-0 items-center gap-1">
        {session && <button
          type="button"
          aria-label={proxyLabel}
          aria-pressed={proxyEnabled}
          aria-busy={proxyBusy === 'enforcement'}
          disabled={Boolean(proxyBusy)}
          onClick={() => void setProxyEnabled(!proxyEnabled).catch(() => undefined)}
          title={proxyLabel}
          className={cn(
            'flex h-5 cursor-pointer items-center overflow-hidden rounded border border-border-subtle bg-raised/35 text-[11px] transition-colors duration-150 hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue disabled:cursor-wait motion-reduce:transition-none',
            proxyStyle.tone,
          )}
        >
          <span className="flex h-full items-center border-r border-current/15 px-1.5 text-text-secondary">
            <Icon name="shield" size={11} />
          </span>
          <span className="flex items-center gap-1.5 px-1.5">
            <span className="font-medium tracking-wide">PROXY</span>
            <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', proxyStyle.dot)} />
            <span className="font-mono font-semibold">{proxyState.toUpperCase()}</span>
          </span>
        </button>}
        <button
          type="button"
          aria-label={isNetMapVisible ? t('status.hideNetMap') : t('status.showNetMap')}
          aria-pressed={isNetMapVisible}
          onClick={toggleNetMap}
          className={cn(
            'flex h-5 cursor-pointer items-center overflow-hidden rounded border text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue motion-reduce:transition-none',
            isNetMapVisible
              ? 'border-border-subtle bg-raised/35 text-accent-teal hover:border-border-strong hover:bg-raised'
              : 'border-border-subtle bg-raised/35 text-text-muted hover:border-border-strong hover:bg-raised hover:text-text-secondary',
          )}
        >
          <span className="flex h-full items-center border-r border-current/15 px-1.5 text-text-secondary">
            <Icon name="map" size={11} />
          </span>
          <span className="flex items-center gap-1.5 px-1.5">
            <span className="font-medium tracking-wide">NETMAP</span>
            <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', isNetMapVisible ? 'bg-accent-teal' : 'bg-text-muted')} />
            <span className="font-mono font-semibold">{isNetMapVisible ? 'ON' : 'OFF'}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
