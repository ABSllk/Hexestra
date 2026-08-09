import { useCallback, useEffect, useMemo, useState } from 'react';
import { DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { useSessionStore, useTabStore } from '@/stores';
import { ShellConnectBuilder } from './ShellConnectBuilder';
import {
  SHELL_IPC,
  LOCAL_OPERATOR_ASSET_ID,
  WEBSHELL_COMMAND_BASE64_PLACEHOLDER,
  WEBSHELL_COMMAND_PLACEHOLDER,
  isLoopbackShellPeer,
  type ReverseListenerProfile,
  type ShellCredentialStatus,
  type ShellListenerRuntime,
  type ShellNetworkInterface,
  type ShellProfile,
  type ShellProfileKind,
  type ShellSession,
  type ShellHttpHeader,
  type WebShellAdapterId,
  type WebShellBodyKind,
  type WebShellCommandMode,
  type WebShellProfileHealth,
  type WebShellResponseExtract,
  type WebShellResponseEncoding,
} from '@electron/contracts/shell';
import { useI18n } from '@/i18n';
import type { PlatformCapabilities } from '@electron/contracts/platform';

type EditorMode = 'none' | 'profile' | 'listener';

const DEFAULT_PROFILE: Partial<ShellProfile> = {
  name: 'SSH session',
  kind: 'ssh',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  assetRole: 'target',
  shellFlavor: 'auto',
};

export function ShellsTab() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const projectId = useSessionStore((state) => state.currentSession?.id);
  const targets = useSessionStore((state) => state.targets);
  const assets = useSessionStore((state) => state.assets);
  const openTab = useTabStore((state) => state.openTab);
  const updateTabData = useTabStore((state) => state.updateTabData);
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [listeners, setListeners] = useState<ShellListenerRuntime[]>([]);
  const [sessions, setSessions] = useState<ShellSession[]>([]);
  const [credentials, setCredentials] = useState<ShellCredentialStatus[]>([]);
  const [interfaces, setInterfaces] = useState<ShellNetworkInterface[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>('none');
  const [profileDraft, setProfileDraft] = useState<Partial<ShellProfile>>(DEFAULT_PROFILE);
  const [listenerDraft, setListenerDraft] = useState<Partial<ReverseListenerProfile>>({
    name: 'Reverse listener', port: 4444, shellFlavor: 'raw',
  });
  const [builderListener, setBuilderListener] = useState<ReverseListenerProfile | null>(null);
  const [credentialSecret, setCredentialSecret] = useState('');
  const [credentialPassphrase, setCredentialPassphrase] = useState('');
  const [health, setHealth] = useState<WebShellProfileHealth[]>([]);
  const [healthBusy, setHealthBusy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);

  useEffect(() => {
    void window.hexestra.invoke<PlatformCapabilities>('app:getCapabilities').then(setCapabilities).catch(() => setCapabilities(null));
  }, []);

  const bindableAssets = useMemo(() => [
    ...targets.map((target) => ({ id: target.id, label: target.hostname || target.ip, status: target.status })),
    ...assets.map((asset) => ({ id: asset.id, label: asset.label, status: asset.status })),
  ].filter((item, index, all) => item.status !== 'out_of_scope' && all.findIndex((candidate) => candidate.id === item.id) === index), [assets, targets]);

  const refresh = useCallback(async () => {
    if (!projectId || !window.hexestra) return;
    try {
      const [nextProfiles, nextListeners, nextSessions, nextCredentials, nextInterfaces, nextHealth] = await Promise.all([
        window.hexestra.invoke<ShellProfile[]>(SHELL_IPC.PROFILE_LIST, projectId),
        window.hexestra.invoke<ShellListenerRuntime[]>(SHELL_IPC.LISTENER_LIST, projectId),
        window.hexestra.invoke<ShellSession[]>(SHELL_IPC.SESSION_LIST, projectId),
        window.hexestra.invoke<ShellCredentialStatus[]>(SHELL_IPC.CREDENTIAL_STATUS, projectId),
        window.hexestra.invoke<ShellNetworkInterface[]>(SHELL_IPC.INTERFACES),
        window.hexestra.invoke<WebShellProfileHealth[]>(SHELL_IPC.PROFILE_HEALTH, projectId),
      ]);
      setProfiles(nextProfiles);
      setListeners(nextListeners);
      setSessions(nextSessions);
      setCredentials(nextCredentials);
      setInterfaces(nextInterfaces);
      setHealth(nextHealth);
      setError('');
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    if (!window.hexestra) return;
    return window.hexestra.on(SHELL_IPC.CHANGED, (payload: unknown) => {
      const event = payload as { projectId?: string };
      if (event.projectId === projectId) void refresh();
    });
  }, [projectId, refresh]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await refresh();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy('');
    }
  };

  const openSession = (session: ShellSession, profile?: ShellProfile) => {
    const existing = useTabStore.getState().tabs.find((tab) => tab.data?.shellSessionId === session.id);
    if (existing) {
      useTabStore.getState().setActiveTab(existing.id);
      return existing.id;
    }
    return openTab({
      type: 'terminal',
      title: session.title,
      icon: 'terminal',
      closable: true,
      data: { managedShell: true, shellProfileId: profile?.id ?? session.profileId, shellSessionId: session.id },
    });
  };

  const connectProfile = async (profile: ShellProfile) => {
    if (!projectId) return;
    const tabId = openTab({
      type: 'terminal', title: profile.name, icon: 'terminal', closable: true,
      data: { managedShell: true, shellProfileId: profile.id },
    });
    const connect = () => window.hexestra.invoke<ShellSession>(SHELL_IPC.SESSION_CONNECT, projectId, profile.id, tabId);
    try {
      const session = await connect();
      updateTabData(tabId, { shellSessionId: session.id });
    } catch (nextError) {
      const message = errorMessage(nextError);
      const confirmation = message.match(/SSH_HOST_KEY_CONFIRMATION_REQUIRED:([a-zA-Z0-9_-]+):(SHA256:[A-Za-z0-9+/=]+)/);
      const trustProfileId = confirmation?.[1];
      const fingerprint = confirmation?.[2];
      if (trustProfileId && fingerprint && await confirm({
        title: 'Trust this SSH host key?',
        description: 'Verify this fingerprint against a trusted source before saving it to the connection profile.',
        details: fingerprint,
        confirmLabel: 'Trust Host Key',
        tone: 'trust',
      })) {
        const trustProfile = profiles.find((item) => item.id === trustProfileId);
        if (!trustProfile) throw new Error('SSH trust profile not found');
        const saved = await window.hexestra.invoke<ShellProfile>(
          SHELL_IPC.PROFILE_SAVE, projectId, { ...trustProfile, hostKeyFingerprint: fingerprint },
        );
        setProfiles((current) => current.map((item) => item.id === saved.id ? saved : item));
        const session = await connect();
        updateTabData(tabId, { shellSessionId: session.id });
      } else {
        setError(message);
      }
    }
  };

  const saveProfile = async () => {
    if (!projectId || !profileDraft.kind) return;
    let credentialId = profileDraft.credentialId;
    if (profileDraft.kind === 'ssh' && credentialSecret) {
      const stored = await window.hexestra.invoke<ShellCredentialStatus>(
        SHELL_IPC.CREDENTIAL_SAVE,
        projectId,
        {
          kind: profileDraft.authMethod ?? 'password',
          label: `${profileDraft.name || profileDraft.host || 'SSH'} credential`,
          secret: credentialSecret,
          passphrase: credentialPassphrase || undefined,
        },
        credentialId,
      );
      credentialId = stored.id;
    }
    await window.hexestra.invoke(SHELL_IPC.PROFILE_SAVE, projectId, { ...profileDraft, credentialId });
    setEditorMode('none');
    setProfileDraft(DEFAULT_PROFILE);
    setCredentialSecret('');
    setCredentialPassphrase('');
  };

  const saveListener = async () => {
    if (!projectId) return;
    await window.hexestra.invoke(SHELL_IPC.LISTENER_SAVE, projectId, listenerDraft);
    setEditorMode('none');
    setListenerDraft({ name: 'Reverse listener', port: 4444, shellFlavor: 'raw' });
  };

  const verifyProfile = async (profileId: string) => {
    if (!projectId) return;
    setHealthBusy(profileId);
    try {
      const result = await window.hexestra.invoke<WebShellProfileHealth>(SHELL_IPC.PROFILE_VERIFY, projectId, profileId);
      setHealth((current) => current.map((item) => item.profileId === profileId ? result : item));
      setError('');
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setHealthBusy('');
    }
  };

  const deleteSession = async (session: ShellSession) => {
    const approved = await confirm({
      title: t('shell.deleteSessionTitle'),
      description: t('shell.deleteSessionDescription'),
      details: `${session.title} · ${session.state}`,
      confirmLabel: t('shell.deleteSession'),
      tone: 'danger',
    });
    if (!approved) return;
    await run(
      `delete-session-${session.id}`,
      () => window.hexestra.invoke(SHELL_IPC.SESSION_DISCONNECT, projectId, session.id),
    );
  };

  if (!projectId) {
    return <EmptyShells message={t('shell.openProject')} />;
  }

  return (
    <div className="flex min-h-full flex-col gap-3 p-2 text-[11px]">
      <div className="flex min-w-0 gap-1">
        <button className="ui-control flex min-w-0 flex-1 items-center justify-center gap-1 truncate" onClick={() => {
          setProfileDraft(DEFAULT_PROFILE);
          setEditorMode('profile');
        }}><Icon name="plus" size={11} /> {t('shell.connection')}</button>
        <button className="ui-control flex min-w-0 flex-1 items-center justify-center gap-1 truncate" onClick={() => setEditorMode('listener')}>
          <Icon name="network" size={11} /> {t('shell.listener')}
        </button>
      </div>

      {editorMode === 'profile' && (
        <ProfileEditor
          draft={profileDraft}
          profiles={profiles}
          credentials={credentials}
          assets={bindableAssets}
          supportsWsl={capabilities?.supportsWsl === true}
          secret={credentialSecret}
          passphrase={credentialPassphrase}
          onChange={setProfileDraft}
          onSecret={setCredentialSecret}
          onPassphrase={setCredentialPassphrase}
          onCancel={() => {
            setEditorMode('none');
            setCredentialSecret('');
            setCredentialPassphrase('');
          }}
          onSave={() => void run('save-profile', saveProfile)}
          busy={busy === 'save-profile'}
        />
      )}

      {editorMode === 'listener' && (
        <ListenerEditor
          draft={listenerDraft}
          interfaces={interfaces}
          onChange={setListenerDraft}
          onCancel={() => setEditorMode('none')}
          onSave={() => void run('save-listener', saveListener)}
          busy={busy === 'save-listener'}
        />
      )}

      {error && <DismissibleNotice tone="error" className="p-2" onDismiss={() => setError('')}>{error}</DismissibleNotice>}

      {builderListener && (
        <ShellConnectBuilder projectId={projectId} listener={builderListener} onClose={() => setBuilderListener(null)} />
      )}

      <ShellSection title={t('shell.profiles')} count={profiles.length}>
        {profiles.length === 0 && <SectionEmpty text={t('shell.noProfiles')} />}
        {profiles.map((profile) => {
          const profileHealth = profile.kind === 'webshell' ? health.find((h) => h.profileId === profile.id) : undefined;
          return (
            <div
              key={profile.id}
              className="group min-w-0 rounded border border-transparent px-2 py-2 hover:border-border-subtle/60 hover:bg-raised/35"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  name={profile.kind === 'ssh' ? 'server' : profile.kind === 'webshell' ? 'network' : 'terminal'}
                  size={12}
                  className="shrink-0 text-accent-blue"
                />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void run(`connect-${profile.id}`, () => connectProfile(profile))}
                >
                  <span className="block truncate text-text-secondary" title={profile.name}>{profile.name}</span>
                  <span className="block truncate font-mono text-[10px] text-text-muted">
                    {profile.kind === 'ssh'
                      ? `${profile.username}@${profile.host}:${profile.port}`
                      : profile.kind === 'webshell'
                        ? `${profile.webshell?.method ?? 'HTTP'} · ${safeWebShellHost(profile.webshell?.url)}`
                        : profile.kind.toUpperCase()}
                  </span>
                </button>
                <div
                  role="group"
                  aria-label={`${profile.name} actions`}
                  className="flex shrink-0 items-center justify-center gap-1"
                >
                  {profile.kind === 'webshell' && (
                    <button
                      type="button"
                      aria-label={`Verify ${profile.name}`}
                      className="ui-icon-button h-5 w-5 disabled:cursor-wait disabled:opacity-50"
                      disabled={healthBusy === profile.id}
                      title="Verify WebShell profile now"
                      onClick={() => void verifyProfile(profile.id)}
                    >
                      <Icon name="activity" size={11} className={healthBusy === profile.id ? 'animate-pulse' : undefined} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Edit ${profile.name}`}
                    title="Edit profile"
                    className="ui-icon-button h-5 w-5"
                    onClick={() => { setProfileDraft(profile); setEditorMode('profile'); }}
                  ><Icon name="edit" size={11} /></button>
                  <button
                    type="button"
                    aria-label={`Delete ${profile.name}`}
                    title="Delete profile"
                    className="ui-icon-button h-5 w-5"
                    onClick={() => void run(`delete-${profile.id}`, () => window.hexestra.invoke(SHELL_IPC.PROFILE_DELETE, projectId, profile.id))}
                  ><Icon name="close" size={11} /></button>
                </div>
              </div>
              {profile.kind === 'webshell' && (
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-5">
                  <span
                    aria-label={`WebShell status: ${profileHealth?.status ?? 'unknown'}`}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${healthStatusColor(profileHealth?.status ?? 'unknown')}`}
                    title={profileHealth ? healthStatusTitle(profileHealth) : 'Status: unknown'}
                  />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase text-text-muted"
                    title={profileHealth ? healthStatusTitle(profileHealth) : 'Status: unknown'}
                  >
                    {profile.webshell?.adapterId ?? 'generic'} · {profileHealth?.status ?? 'unknown'}
                    {profileHealth?.latencyMs !== undefined ? ` · ${profileHealth.latencyMs}ms` : ''}
                    {profileHealth ? ` · ${profileHealth.consecutiveFailures} fail` : ''}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </ShellSection>

      <ShellSection title={t('shell.listen')} count={listeners.length}>
        {listeners.length === 0 && <SectionEmpty text={t('shell.noListeners')} />}
        {listeners.map(({ profile, state, sessionCount }) => (
          <div key={profile.id} className="group flex min-w-0 flex-wrap items-center gap-1.5 rounded px-1.5 py-1.5 hover:bg-raised/35">
            <span className={`h-1.5 w-1.5 rounded-full ${state === 'listening' ? 'bg-accent-green' : state === 'error' ? 'bg-accent-red' : 'bg-text-muted'}`} />
            <div className="min-w-0 flex-1 basis-24">
              <span className="block truncate text-text-secondary">{profile.name}</span>
              <span className="font-mono text-[11px] text-text-muted">{profile.bindAddress}:{profile.port} · {sessionCount}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="shrink-0 rounded border border-accent-purple/30 px-1.5 py-0.5 text-[11px] text-accent-purple"
                title="Generate a connection command"
                onClick={() => setBuilderListener(profile)}
              >Generate</button>
              <button
                className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-text-muted hover:text-text-primary"
                onClick={() => void run(`listener-${profile.id}`, () => window.hexestra.invoke(
                  state === 'listening' ? SHELL_IPC.LISTENER_STOP : SHELL_IPC.LISTENER_START,
                  projectId,
                  profile.id,
                ))}
              >{busy === `listener-${profile.id}` ? '…' : state === 'listening' ? 'Stop' : 'Start'}</button>
              <button
                type="button"
                aria-label="Delete listener"
                title={state === 'listening' ? 'Stop listener before deleting' : 'Delete listener'}
                disabled={state === 'listening' || busy === `delete-listener-${profile.id}`}
                className="ui-icon-button h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
                onClick={() => void run(
                  `delete-listener-${profile.id}`,
                  () => window.hexestra.invoke(SHELL_IPC.LISTENER_DELETE, projectId, profile.id),
                )}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
        ))}
      </ShellSection>

      <ShellSection title={t('shell.sessions')} count={sessions.length}>
        {sessions.length === 0 && <SectionEmpty text="No live or disconnected sessions" />}
        {sessions.map((session) => (
          <div key={session.id} className="rounded border border-transparent px-1.5 py-1.5 hover:border-border-subtle/60 hover:bg-raised/25">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${session.state === 'ready' ? 'bg-accent-green' : session.state === 'agent_locked' ? 'bg-accent-yellow' : session.state === 'quarantined' ? 'bg-accent-purple' : 'bg-text-muted'}`} />
              <button className="min-w-0 flex-1 truncate text-left text-text-secondary" onClick={() => openSession(session, profiles.find((profile) => profile.id === session.profileId))}>{session.title}</button>
              <span className="max-w-24 shrink-0 truncate font-mono text-[11px] uppercase text-text-muted" title={session.state}>{session.state}</span>
              <button
                type="button"
                aria-label={t('shell.deleteSession')}
                title={t('shell.deleteSession')}
                disabled={busy === `delete-session-${session.id}`}
                className="ui-icon-button h-5 w-5 shrink-0 disabled:cursor-wait disabled:opacity-40"
                onClick={() => void deleteSession(session)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
            {session.kind === 'webshell' && session.webshellRuntime && (
              <div className="mt-1 pl-3.5 font-mono text-[10px] uppercase text-text-muted">
                {session.webshellRuntime.adapterId} · {session.webshellRuntime.shellFlavor}{session.webshellRuntime.commandMode ? ` · ${session.webshellRuntime.commandMode}` : ''}
              </div>
            )}
            {session.kind === 'webshell' && session.webshellCommandMode && !session.webshellRuntime && (
              <div className="mt-1 pl-3.5 font-mono text-[10px] uppercase text-text-muted">
                {webShellCommandModeLabel(session.webshellCommandMode)} · {session.shellFlavor}
              </div>
            )}
            {session.state === 'quarantined' && (
              <div className="mt-1.5 flex gap-1 pl-3.5">
                <select className="ui-control min-w-0 flex-1 px-1 text-[11px]" defaultValue="" onChange={(event) => {
                  if (event.target.value) void run(`bind-${session.id}`, () => window.hexestra.invoke(SHELL_IPC.REVERSE_BIND, projectId, session.id, event.target.value));
                }}>
                  <option value="">Bind to Scope asset…</option>
                  {isLoopbackShellPeer(session.peer?.address) && <option value={LOCAL_OPERATOR_ASSET_ID}>This Hexestra device · loopback</option>}
                  {bindableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
                </select>
                <button className="ui-icon-button" title="Reject connection" onClick={() => void run(`reject-${session.id}`, () => window.hexestra.invoke(SHELL_IPC.REVERSE_REJECT, projectId, session.id))}><Icon name="close" size={11} /></button>
              </div>
            )}
            {session.preview && <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-all rounded bg-panel p-1 font-mono text-[11px] text-text-muted">{session.preview}</pre>}
          </div>
        ))}
      </ShellSection>
    </div>
  );
}

function ProfileEditor({ draft, profiles, credentials, assets, supportsWsl, secret, passphrase, onChange, onSecret, onPassphrase, onCancel, onSave, busy }: {
  draft: Partial<ShellProfile>;
  profiles: ShellProfile[];
  credentials: ShellCredentialStatus[];
  assets: Array<{ id: string; label: string }>;
  supportsWsl: boolean;
  secret: string;
  passphrase: string;
  onChange: (draft: Partial<ShellProfile>) => void;
  onSecret: (value: string) => void;
  onPassphrase: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof ShellProfile>(key: K, value: ShellProfile[K]) => onChange({ ...draft, [key]: value });
  const kind = draft.kind ?? 'ssh';
  return (
    <div className="space-y-2 rounded border border-border-subtle bg-canvas p-2">
      <div className="flex items-center justify-between text-text-secondary"><span>{draft.id ? 'Edit connection' : 'New connection'}</span><button onClick={onCancel}><Icon name="close" size={11} /></button></div>
      <select className="ui-control h-7 w-full px-2" value={kind} onChange={(event) => set('kind', event.target.value as ShellProfileKind)}>
        <option value="ssh">SSH</option><option value="webshell">WebShell</option><option value="local">Local</option>{supportsWsl && <option value="wsl">WSL</option>}
      </select>
      <input className="ui-control h-7 w-full px-2" placeholder="Name" value={draft.name ?? ''} onChange={(event) => set('name', event.target.value)} />
      <select className="ui-control h-7 w-full px-2" value={draft.assetId ?? ''} onChange={(event) => set('assetId', event.target.value || undefined)}>
        <option value="">No linked asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
      </select>
      {kind === 'ssh' && <>
        <div className="grid grid-cols-[1fr_62px] gap-1"><input className="ui-control h-7 px-2" placeholder="Host" value={draft.host ?? ''} onChange={(event) => set('host', event.target.value)} /><input className="ui-control h-7 px-2" type="number" min={1} max={65535} value={draft.port ?? 22} onChange={(event) => set('port', Number(event.target.value))} /></div>
        <input className="ui-control h-7 w-full px-2" placeholder="Username" value={draft.username ?? ''} onChange={(event) => set('username', event.target.value)} />
        <select className="ui-control h-7 w-full px-2" value={draft.authMethod ?? 'password'} onChange={(event) => set('authMethod', event.target.value as ShellProfile['authMethod'])}>
          <option value="password">Password</option><option value="private_key">Private key</option><option value="keyboard_interactive">Keyboard interactive</option>
        </select>
        {credentials.length > 0 && <select className="ui-control h-7 w-full px-2" value={draft.credentialId ?? ''} onChange={(event) => set('credentialId', event.target.value || undefined)}><option value="">New credential below</option>{credentials.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}
        {draft.authMethod === 'private_key' ? <textarea className="ui-control min-h-20 w-full resize-y p-2 font-mono text-[11px]" placeholder="Paste OpenSSH or PEM private key" value={secret} onChange={(event) => onSecret(event.target.value)} /> : <input className="ui-control h-7 w-full px-2" type="password" placeholder={draft.credentialId ? 'Leave blank to keep saved credential' : 'Password'} value={secret} onChange={(event) => onSecret(event.target.value)} />}
        {draft.authMethod === 'private_key' && <input className="ui-control h-7 w-full px-2" type="password" placeholder="Private-key passphrase (optional)" value={passphrase} onChange={(event) => onPassphrase(event.target.value)} />}
        <select className="ui-control h-7 w-full px-2" value={draft.jumpProfileId ?? ''} onChange={(event) => set('jumpProfileId', event.target.value || undefined)}><option value="">No jump host</option>{profiles.filter((item) => item.kind === 'ssh' && item.id !== draft.id && !item.jumpProfileId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className="ui-control h-7 w-full px-2" value={draft.assetRole ?? 'target'} onChange={(event) => set('assetRole', event.target.value as ShellProfile['assetRole'])}><option value="target">Target</option><option value="infrastructure">Infrastructure / jump only</option></select>
      </>}
      {kind === 'webshell' && <WebShellEditor draft={draft} onChange={onChange} />}
      {supportsWsl && kind === 'wsl' && <input className="ui-control h-7 w-full px-2" placeholder="WSL distribution (optional)" value={draft.wslDistribution ?? ''} onChange={(event) => set('wslDistribution', event.target.value)} />}
      <label className="block text-[10px] uppercase tracking-wide text-text-muted">Shell flavor</label>
      <select className="ui-control h-7 w-full px-2" value={draft.shellFlavor ?? (kind === 'wsl' ? 'posix' : kind === 'local' ? 'powershell' : 'auto')} onChange={(event) => set('shellFlavor', event.target.value as ShellProfile['shellFlavor'])}>
        <option value="auto">Auto detect</option><option value="posix">POSIX</option><option value="powershell">PowerShell</option><option value="cmd">cmd.exe</option>
        {kind !== 'webshell' && <option value="raw">Raw / unknown</option>}
      </select>
      <button disabled={busy} className="h-7 w-full rounded border border-accent-blue/50 bg-accent-blue/10 text-accent-blue disabled:opacity-50" onClick={onSave}>{busy ? 'Saving…' : 'Save connection'}</button>
    </div>
  );
}

const DEFAULT_WEBSHELL = {
  url: 'http://127.0.0.1/shell?cmd={{command}}',
  method: 'GET' as const,
  headers: [] as ShellHttpHeader[],
  bodyKind: 'none' as WebShellBodyKind,
  commandMode: 'auto' as WebShellCommandMode,
  responseExtract: 'body' as WebShellResponseExtract,
  responseEncoding: 'auto' as WebShellResponseEncoding,
  allowInvalidTls: false,
  adapterId: 'generic' as WebShellAdapterId,
  runtime: 'auto' as const,
};

function WebShellEditor({ draft, onChange }: {
  draft: Partial<ShellProfile>;
  onChange: (draft: Partial<ShellProfile>) => void;
}) {
  const options = { ...DEFAULT_WEBSHELL, ...draft.webshell };
  const adapterId: WebShellAdapterId = options.adapterId ?? 'generic';
  const update = (patch: Partial<typeof options>) => onChange({ ...draft, webshell: { ...options, ...patch } });
  const headersText = options.headers.map(({ name, value }) => `${name}: ${value}`).join('\n');
  const setAdapter = (id: WebShellAdapterId) => {
    if (id === 'antsword.v2.php') {
      update({
        adapterId: id,
        method: 'POST',
        bodyKind: 'form',
        commandMode: 'php_eval',
        runtime: 'php',
        url: options.url,
        bodyTemplate: undefined,
      });
    } else {
      update({ adapterId: id, runtime: 'auto', antsword: undefined });
    }
  };
  return <div className="space-y-2 rounded border border-accent-blue/20 bg-accent-blue/5 p-2">
    <div className="grid grid-cols-[1fr_1fr] gap-1">
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-text-muted">Adapter</label>
        <select aria-label="WebShell adapter" className="ui-control h-7 w-full px-2" value={adapterId} onChange={(event) => setAdapter(event.target.value as WebShellAdapterId)}>
          <option value="generic">Generic HTTP</option>
          <option value="antsword.v2.php">AntSword-compatible PHP</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-text-muted">Runtime</label>
        <select aria-label="WebShell runtime" className="ui-control h-7 w-full px-2" value={options.runtime ?? (adapterId === 'antsword.v2.php' ? 'php' : 'auto')} onChange={(event) => update({ runtime: event.target.value as typeof options.runtime })} disabled={adapterId === 'antsword.v2.php'}>
          <option value="auto">Auto detect</option>
          <option value="php">PHP</option>
          <option value="jsp">JSP</option>
          <option value="jspx">JSPX</option>
          <option value="aspx">ASPX</option>
        </select>
      </div>
    </div>
    {adapterId === 'antsword.v2.php' && (
      <div className="space-y-2 rounded border border-accent-purple/20 bg-accent-purple/5 p-2">
        <p className="text-[10px] leading-3 text-text-muted">AntSword v2 PHP-compatible request shape. The adapter owns the POST form body; Base64/Hex require a matching endpoint decoder.</p>
        <div className="grid grid-cols-[1fr_90px] gap-1">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-muted">Password parameter</label>
            <input aria-label="AntSword password parameter" className="ui-control h-7 w-full px-2 font-mono text-[11px]" placeholder="ant" value={options.antsword?.passwordParameter ?? ''} onChange={(event) => update({ antsword: { passwordParameter: event.target.value, encoder: options.antsword?.encoder ?? 'raw' } })} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-text-muted">Encoder</label>
            <select aria-label="AntSword encoder" className="ui-control h-7 w-full px-2" value={options.antsword?.encoder ?? 'raw'} onChange={(event) => update({ antsword: { passwordParameter: options.antsword?.passwordParameter ?? 'ant', encoder: event.target.value as 'raw' | 'base64' | 'hex' } })}>
              <option value="raw">Raw</option>
              <option value="base64">Base64</option>
              <option value="hex">Hex</option>
            </select>
          </div>
        </div>
      </div>
    )}
    {adapterId === 'generic' && (
    <label className="block text-[10px] uppercase tracking-wide text-text-muted">Endpoint URL</label>
    )}
    <input aria-label="WebShell endpoint URL" className="ui-control h-7 w-full px-2 font-mono text-[11px]" value={options.url} onChange={(event) => update({ url: event.target.value })} />
    <label className="block text-[10px] uppercase tracking-wide text-text-muted">Headers (one `Name: value` per line)</label>
    <textarea aria-label="WebShell headers" className="ui-control min-h-14 w-full resize-y p-2 font-mono text-[11px]" value={headersText} onChange={(event) => update({ headers: parseHeaderText(event.target.value) })} />
    {adapterId === 'generic' && (
    <div className="grid grid-cols-[90px_1fr_1fr] gap-1">
      <div><label className="block text-[10px] uppercase tracking-wide text-text-muted">Method</label><select aria-label="WebShell method" className="ui-control h-7 w-full px-2" value={options.method} onChange={(event) => update({ method: event.target.value as typeof options.method })}><option value="GET">GET</option><option value="POST">POST</option></select></div>
      <div><label className="block text-[10px] uppercase tracking-wide text-text-muted">Body</label><select aria-label="WebShell body kind" className="ui-control h-7 w-full px-2" value={options.bodyKind} onChange={(event) => { const bodyKind = event.target.value as WebShellBodyKind; update({ bodyKind, bodyTemplate: bodyKind === 'none' ? undefined : options.bodyTemplate }); }}><option value="none">None / URL</option><option value="form">Form URL encoded</option><option value="json">JSON</option><option value="raw">Raw text</option></select></div>
      <div><label className="block text-[10px] uppercase tracking-wide text-text-muted">Input mode</label><select aria-label="WebShell command mode" className="ui-control h-7 w-full px-2" value={options.commandMode} onChange={(event) => update({ commandMode: event.target.value as WebShellCommandMode })}><option value="auto">Auto detect</option><option value="os">OS command</option><option value="php_eval">PHP eval</option></select></div>
    </div>
    )}
    {adapterId === 'generic' && options.bodyKind !== 'none' && <>
      <label className="block text-[10px] uppercase tracking-wide text-text-muted">Body template</label>
      <textarea aria-label="WebShell body template" className="ui-control min-h-16 w-full resize-y p-2 font-mono text-[11px]" value={options.bodyTemplate ?? ''} onChange={(event) => update({ bodyTemplate: event.target.value })} />
    </>}
    {adapterId === 'generic' && (
    <p className="text-[10px] leading-3 text-text-muted">
      Put exactly one <code>{WEBSHELL_COMMAND_PLACEHOLDER}</code> or <code>{WEBSHELL_COMMAND_BASE64_PLACEHOLDER}</code> placeholder in the URL or body. Auto detect distinguishes direct OS-command shells from PHP eval/assert shells; Shell flavor describes the target OS command interpreter.
    </p>
    )}
    <div className="grid grid-cols-[1fr_1fr] gap-1">
      <div><label className="block text-[10px] uppercase tracking-wide text-text-muted">Response extraction</label><select aria-label="WebShell response extraction" className="ui-control h-7 w-full px-2" value={options.responseExtract} onChange={(event) => update({ responseExtract: event.target.value as WebShellResponseExtract })}><option value="body">Full body</option><option value="between">Between delimiters</option><option value="regex">Regex capture</option></select></div>
      <div><label className="block text-[10px] uppercase tracking-wide text-text-muted">Encoding</label><select aria-label="WebShell response encoding" className="ui-control h-7 w-full px-2" value={options.responseEncoding} onChange={(event) => update({ responseEncoding: event.target.value as WebShellResponseEncoding })}><option value="auto">Auto / UTF-8</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></select></div>
    </div>
    {options.responseExtract === 'between' && <div className="grid grid-cols-[1fr_1fr] gap-1"><input aria-label="WebShell response start delimiter" className="ui-control h-7 px-2 font-mono text-[11px]" placeholder="Start delimiter" value={options.responseStart ?? ''} onChange={(event) => update({ responseStart: event.target.value })} /><input aria-label="WebShell response end delimiter" className="ui-control h-7 px-2 font-mono text-[11px]" placeholder="End delimiter" value={options.responseEnd ?? ''} onChange={(event) => update({ responseEnd: event.target.value })} /></div>}
    {options.responseExtract === 'regex' && <input aria-label="WebShell response regex" className="ui-control h-7 w-full px-2 font-mono text-[11px]" placeholder="Regex with one capture group" value={options.responseRegex ?? ''} onChange={(event) => update({ responseRegex: event.target.value })} />}
    <label className="flex items-center gap-2 text-[11px] text-text-muted"><input type="checkbox" checked={options.allowInvalidTls} onChange={(event) => update({ allowInvalidTls: event.target.checked })} /> Allow invalid TLS certificates</label>
    <select aria-label="WebShell asset role" className="ui-control h-7 w-full px-2" value={draft.assetRole ?? 'target'} onChange={(event) => onChange({ ...draft, assetRole: event.target.value as ShellProfile['assetRole'] })}><option value="target">Target / Agent commands allowed</option><option value="infrastructure">Infrastructure / Agent commands disabled</option></select>
  </div>;
}

function parseHeaderText(value: string): ShellHttpHeader[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return [];
    return [{ name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }];
  });
}

function safeWebShellHost(value?: string) {
  if (!value) return 'WEB SHELL';
  try { return new URL(value).host || 'WEB SHELL'; } catch { return 'WEB SHELL'; }
}

function webShellCommandModeLabel(mode: NonNullable<ShellSession['webshellCommandMode']>) {
  return mode === 'php_eval' ? 'PHP eval' : 'OS command';
}

function ListenerEditor({ draft, interfaces, onChange, onCancel, onSave, busy }: {
  draft: Partial<ReverseListenerProfile>;
  interfaces: ShellNetworkInterface[];
  onChange: (draft: Partial<ReverseListenerProfile>) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  return <div className="space-y-2 rounded border border-border-subtle bg-canvas p-2">
    <div className="flex items-center justify-between text-text-secondary"><span>New reverse listener</span><button onClick={onCancel}><Icon name="close" size={11} /></button></div>
    <input className="ui-control h-7 w-full px-2" placeholder="Name" value={draft.name ?? ''} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
    <select className="ui-control h-7 w-full px-2" value={draft.bindAddress ?? ''} onChange={(event) => onChange({ ...draft, bindAddress: event.target.value })}><option value="">Choose a concrete interface…</option>{interfaces.map((item) => <option key={`${item.name}-${item.address}`} value={item.address}>{item.name} · {item.address}</option>)}</select>
    <input className="ui-control h-7 w-full px-2" type="number" min={1} max={65535} value={draft.port ?? 4444} onChange={(event) => onChange({ ...draft, port: Number(event.target.value) })} />
    <select className="ui-control h-7 w-full px-2" value={draft.shellFlavor ?? 'raw'} onChange={(event) => onChange({ ...draft, shellFlavor: event.target.value as ReverseListenerProfile['shellFlavor'] })}><option value="raw">Unknown/raw</option><option value="posix">POSIX</option><option value="powershell">PowerShell</option><option value="cmd">cmd.exe</option></select>
    <p className="text-[11px] leading-3 text-text-muted">Hexestra never changes the firewall or creates a public tunnel.</p>
    <button disabled={busy} className="h-7 w-full rounded border border-accent-purple/50 bg-accent-purple/10 text-accent-purple disabled:opacity-50" onClick={onSave}>{busy ? 'Saving…' : 'Save listener'}</button>
  </div>;
}

function ShellSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section><div className="mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted"><span>{title}</span><span className="rounded bg-raised px-1 font-mono text-[11px]">{count}</span></div><div>{children}</div></section>;
}

function SectionEmpty({ text }: { text: string }) {
  return <div className="px-2 py-2 text-[11px] italic text-text-muted">{text}</div>;
}

function EmptyShells({ message }: { message: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-[11px] text-text-muted"><Icon name="terminal" size={24} />{message}</div>;
}

function healthStatusColor(status: WebShellProfileHealth['status']) {
  switch (status) {
    case 'healthy': return 'bg-accent-green';
    case 'degraded': return 'bg-accent-yellow';
    case 'unreachable': return 'bg-accent-red';
    case 'stale': return 'bg-accent-purple';
    default: return 'bg-text-muted';
  }
}

function healthStatusTitle(health: WebShellProfileHealth) {
  const parts = [`Status: ${health.status}`];
  if (health.adapterId) parts.push(`Adapter: ${health.adapterId}`);
  if (health.runtime) parts.push(`Runtime: ${health.runtime}`);
  if (health.shellFlavor) parts.push(`Flavor: ${health.shellFlavor}`);
  if (health.latencyMs !== undefined) parts.push(`Latency: ${health.latencyMs}ms`);
  parts.push(`Consecutive failures: ${health.consecutiveFailures}`);
  if (health.successRate !== undefined) parts.push(`Success rate: ${Math.round(health.successRate * 100)}%`);
  if (health.lastCheckedAt) parts.push(`Last checked: ${new Date(health.lastCheckedAt).toLocaleString()}`);
  if (health.lastSuccessAt) parts.push(`Last success: ${new Date(health.lastSuccessAt).toLocaleString()}`);
  if (health.lastError) parts.push(`Error: ${health.lastError}`);
  if (health.systemInfo?.os) parts.push(`OS: ${health.systemInfo.os}`);
  if (health.systemInfo?.hostname) parts.push(`Host: ${health.systemInfo.hostname}`);
  if (health.systemInfo?.user) parts.push(`User: ${health.systemInfo.user}`);
  if (health.systemInfo?.cwd) parts.push(`CWD: ${health.systemInfo.cwd}`);
  if (health.systemInfo?.runtimeVersion) parts.push(`Runtime version: ${health.systemInfo.runtimeVersion}`);
  return parts.join('\n');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
