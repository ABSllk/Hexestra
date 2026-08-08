import { useCallback, useEffect, useMemo, useState } from 'react';
import { DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { useSessionStore, useTabStore } from '@/stores';
import { ShellConnectBuilder } from './ShellConnectBuilder';
import {
  SHELL_IPC,
  LOCAL_OPERATOR_ASSET_ID,
  isLoopbackShellPeer,
  type ReverseListenerProfile,
  type ShellCredentialStatus,
  type ShellListenerRuntime,
  type ShellNetworkInterface,
  type ShellProfile,
  type ShellProfileKind,
  type ShellSession,
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
      const [nextProfiles, nextListeners, nextSessions, nextCredentials, nextInterfaces] = await Promise.all([
        window.hexestra.invoke<ShellProfile[]>(SHELL_IPC.PROFILE_LIST, projectId),
        window.hexestra.invoke<ShellListenerRuntime[]>(SHELL_IPC.LISTENER_LIST, projectId),
        window.hexestra.invoke<ShellSession[]>(SHELL_IPC.SESSION_LIST, projectId),
        window.hexestra.invoke<ShellCredentialStatus[]>(SHELL_IPC.CREDENTIAL_STATUS, projectId),
        window.hexestra.invoke<ShellNetworkInterface[]>(SHELL_IPC.INTERFACES),
      ]);
      setProfiles(nextProfiles);
      setListeners(nextListeners);
      setSessions(nextSessions);
      setCredentials(nextCredentials);
      setInterfaces(nextInterfaces);
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
        {profiles.map((profile) => (
          <div key={profile.id} className="group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1.5 hover:bg-raised/35">
            <Icon name={profile.kind === 'ssh' ? 'server' : 'terminal'} size={12} className="text-accent-blue" />
            <button className="min-w-0 flex-1 text-left" onClick={() => void run(`connect-${profile.id}`, () => connectProfile(profile))}>
              <span className="block truncate text-text-secondary">{profile.name}</span>
              <span className="block truncate font-mono text-[11px] text-text-muted">{profile.kind === 'ssh' ? `${profile.username}@${profile.host}:${profile.port}` : profile.kind.toUpperCase()}</span>
            </button>
            <span className="max-w-20 shrink-0 truncate text-[11px] uppercase text-text-muted" title={profile.assetRole}>{busy === `connect-${profile.id}` ? '…' : profile.assetRole}</span>
            <button title="Edit profile" className="ui-icon-button h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100" onClick={() => { setProfileDraft(profile); setEditorMode('profile'); }}><Icon name="edit" size={11} /></button>
            <button title="Delete profile" className="ui-icon-button h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100" onClick={() => void run(`delete-${profile.id}`, () => window.hexestra.invoke(SHELL_IPC.PROFILE_DELETE, projectId, profile.id))}><Icon name="close" size={11} /></button>
          </div>
        ))}
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
            </div>
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
        <option value="ssh">SSH</option><option value="local">Local</option>{supportsWsl && <option value="wsl">WSL</option>}
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
      {supportsWsl && kind === 'wsl' && <input className="ui-control h-7 w-full px-2" placeholder="WSL distribution (optional)" value={draft.wslDistribution ?? ''} onChange={(event) => set('wslDistribution', event.target.value)} />}
      <select className="ui-control h-7 w-full px-2" value={draft.shellFlavor ?? (kind === 'wsl' ? 'posix' : kind === 'local' ? 'powershell' : 'auto')} onChange={(event) => set('shellFlavor', event.target.value as ShellProfile['shellFlavor'])}><option value="auto">Auto detect</option><option value="posix">POSIX</option><option value="powershell">PowerShell</option><option value="cmd">cmd.exe</option><option value="raw">Raw / unknown</option></select>
      <button disabled={busy} className="h-7 w-full rounded border border-accent-blue/50 bg-accent-blue/10 text-accent-blue disabled:opacity-50" onClick={onSave}>{busy ? 'Saving…' : 'Save connection'}</button>
    </div>
  );
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
