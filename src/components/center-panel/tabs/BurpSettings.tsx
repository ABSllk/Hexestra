import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DismissibleNotice, Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/stores';
import {
  DEFAULT_PROXY_PROFILE,
  TRAFFIC_IPC,
  type ProxyProfile,
  type TrafficChangedEvent,
  type TrafficProfileState,
} from '@electron/contracts/traffic';
import { useI18n } from '@/i18n';

export function BurpSettings() {
  const { t } = useI18n();
  const projectId = useSessionStore((state) => state.currentSession?.id ?? null);
  const [profileState, setProfileState] = useState<TrafficProfileState | null>(null);
  const [draft, setDraft] = useState<ProxyProfile['burp'] | null>(null);
  const [saved, setSaved] = useState<ProxyProfile['burp'] | null>(null);
  const [busy, setBusy] = useState<'save' | 'connect' | 'disconnect' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const value = await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, projectId);
    setProfileState(value);
    setDraft(value.profile.burp);
    setSaved(value.profile.burp);
  }, [projectId]);

  const refreshStatus = useCallback(async () => {
    if (!projectId) return;
    setProfileState(await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, projectId));
  }, [projectId]);

  useEffect(() => {
    setProfileState(null);
    setDraft(null);
    setSaved(null);
    setError(null);
    setNotice(null);
    if (!projectId) return;
    void load().catch((reason) => setError(errorMessage(reason)));
  }, [load, projectId]);

  useEffect(() => window.hexestra.on(TRAFFIC_IPC.CHANGED, (value) => {
    const event = value as TrafficChangedEvent;
    if (event.projectId === projectId && event.profile) void refreshStatus().catch(() => undefined);
  }), [projectId, refreshStatus]);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<unknown>, success?: string) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (success) setNotice(success);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!projectId || !draft || !profileState) return;
    void run('save', () => window.hexestra.invoke(
      TRAFFIC_IPC.UPDATE_PROFILE,
      projectId,
      { ...profileState.profile, burp: draft },
    ), 'Burp settings saved for this project.');
  };

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-xs text-text-muted">{t('burp.openProject')}</div>;
  }
  if (!draft || !saved || !profileState) {
    return <div className="flex h-full items-center justify-center text-xs text-text-muted">{t('burp.loading')}</div>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const enabled = profileState.profile.burp.enabled;
  const bridgeReady = profileState.burpStatus.bridgeReachable === true;

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="mx-auto max-w-3xl px-8 py-7">
        <header className="mb-7 flex items-start justify-between gap-4 border-b border-surface pb-5">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Icon name="activity" size={18} className="text-accent-blue" />
              <h1 className="text-lg font-semibold text-text-primary">{t('burp.title')}</h1>
            </div>
            <p className="max-w-xl text-xs leading-5 text-text-muted">
              {t('burp.description')}
            </p>
          </div>
          <span className="rounded border border-surface bg-bg-tertiary px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">{t('burp.project')}</span>
        </header>

        <section className="mb-6 grid grid-cols-[180px_1fr] gap-6">
          <div>
            <h2 className="text-xs font-semibold text-text-secondary">Hexestra Bridge</h2>
            <p className="mt-1 text-[10px] leading-4 text-text-muted">{t('burp.bridgeHelp')}</p>
          </div>
          <div className="space-y-4">
            <Field label="Bridge port" hint="Loopback only">
              <input aria-label="Burp Bridge port" type="number" min={1} max={65535} className="settings-input font-mono" value={draft.bridgePort} onChange={(event) => setDraft({ ...draft, bridgePort: Number(event.target.value) })} />
            </Field>
            <Field label="Pairing token" hint="Shown in Burp → Hexestra Bridge">
              <input aria-label="Burp Bridge pairing token" type="password" autoComplete="off" className="settings-input font-mono" value={draft.bridgeToken} onChange={(event) => setDraft({ ...draft, bridgeToken: event.target.value })} placeholder="Paste the Bridge token" />
            </Field>
            <div className="rounded border border-surface bg-bg-tertiary/45 p-3 text-[10px] leading-4 text-text-muted">
              Mirrored exchanges appear in Burp <span className="text-text-secondary">Target → Site map</span> and optionally <span className="text-text-secondary">Organizer</span>.
              Burp does not provide an API for inserting synthetic entries into <span className="text-text-secondary">Proxy → HTTP history</span>.
            </div>
          </div>
        </section>

        <section className="mb-6 grid grid-cols-[180px_1fr] gap-6">
          <div>
            <h2 className="text-xs font-semibold text-text-secondary">{t('burp.mcpTools')}</h2>
            <p className="mt-1 text-[10px] leading-4 text-text-muted">{t('burp.mcpHelp')}</p>
          </div>
          <Field label="MCP SSE endpoint" hint="Failure does not stop capture or mirroring">
            <input aria-label="Burp MCP SSE endpoint" className="settings-input font-mono" value={draft.mcpUrl} onChange={(event) => setDraft({ ...draft, mcpUrl: event.target.value })} />
          </Field>
        </section>

        <section className="mb-5 rounded border border-surface bg-bg-tertiary/35 p-3" aria-label="Burp integration status">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', bridgeReady ? 'bg-accent-green' : enabled ? 'bg-severity-medium' : 'bg-text-muted')} />
            <span className="text-xs font-semibold text-text-secondary">{bridgeReady ? t('burp.connected') : enabled ? t('burp.offline') : t('burp.disconnected')}</span>
            <span className="ml-auto font-mono text-[9px] text-text-muted">{profileState.mirrorStatus.synced} synced · {profileState.mirrorStatus.pending} pending · {profileState.mirrorStatus.failed} failed</span>
          </div>
          <p className="text-[10px] leading-4 text-text-muted">
            {profileState.burpStatus.mcpReachable ? `${profileState.burpStatus.edition} MCP · ${profileState.burpStatus.tools.length} tools` : 'MCP tools unavailable'}
          </p>
        </section>

        {error && <DismissibleNotice tone="error" className="mb-4 text-xs" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
        {notice && <DismissibleNotice tone="success" className="mb-4 text-xs" onDismiss={() => setNotice(null)}>{notice}</DismissibleNotice>}

        <footer className="flex items-center justify-between border-t border-surface pt-4">
          <button
            onClick={() => setDraft({ ...DEFAULT_PROXY_PROFILE.burp, enabled: draft.enabled })}
            disabled={busy !== null}
            className="rounded px-3 py-1.5 text-xs text-text-muted hover:bg-surface hover:text-text-secondary disabled:opacity-40"
          >{t('burp.resetFields')}</button>
          <div className="flex gap-2">
            {enabled && <button onClick={() => void run('sync', () => window.hexestra.invoke(TRAFFIC_IPC.BURP_CONNECT, projectId), 'Bridge reconnected and pending exchanges queued.')} disabled={busy !== null || dirty} className="rounded border border-surface px-3 py-1.5 text-xs text-text-secondary hover:border-accent-teal/40 hover:text-accent-teal disabled:opacity-40">{t('burp.reconnect')}</button>}
            <button onClick={() => void run(enabled ? 'disconnect' : 'connect', () => window.hexestra.invoke(enabled ? TRAFFIC_IPC.BURP_DISCONNECT : TRAFFIC_IPC.BURP_CONNECT, projectId))} disabled={busy !== null || dirty} className="rounded border border-surface px-3 py-1.5 text-xs text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue disabled:opacity-40">{enabled ? t('burp.disconnect') : t('burp.connect')}</button>
            <button onClick={save} disabled={busy !== null || !dirty} className="rounded border border-accent-blue/30 bg-accent-blue/15 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/20 disabled:opacity-40">{busy === 'save' ? t('settings.saving') : dirty ? t('settings.saveChanges') : t('common.saved')}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 flex items-baseline justify-between gap-3"><span className="text-xs font-medium text-text-secondary">{label}</span><span className="text-[9px] text-text-muted">{hint}</span></span>{children}</label>;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
