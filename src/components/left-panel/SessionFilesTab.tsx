import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, useConfirmDialog } from '@/components/shared';
import { useSessionStore, useTabStore } from '@/stores';
import type { SessionFileEntry } from '@/types';
import { isSessionDataChangedEvent } from '@electron/contracts/session';
import {
  SHELL_IPC,
  type ShellFileTransferEvent,
  type ShellRemoteDeletePreview,
  type ShellRemoteFileContent,
  type ShellRemoteFileEntry,
  type ShellRemoteUploadPlan,
  type ShellSession,
} from '@electron/contracts/shell';

type FileSource = 'project' | string;

export function SessionFilesTab() {
  const session = useSessionStore((state) => state.currentSession);
  const rootFiles = useSessionStore((state) => state.files);
  const loadFiles = useSessionStore((state) => state.loadFiles);
  const openTab = useTabStore((state) => state.openTab);
  const confirm = useConfirmDialog();
  const [source, setSource] = useState<FileSource>('project');
  const [remoteSessions, setRemoteSessions] = useState<ShellSession[]>([]);
  const [pathValue, setPathValue] = useState('');
  const [entries, setEntries] = useState<SessionFileEntry[]>(rootFiles);
  const [remoteEntries, setRemoteEntries] = useState<ShellRemoteFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState<ShellFileTransferEvent | null>(null);
  const pathRef = useRef('');
  const remotePathRef = useRef('');
  const refreshSequenceRef = useRef(0);
  const remoteSequenceRef = useRef(0);
  const remoteSourceRef = useRef<string | undefined>();
  const remoteSessionId = source === 'project' ? undefined : source;
  remoteSourceRef.current = remoteSessionId;
  const remoteSession = remoteSessions.find((candidate) => candidate.id === remoteSessionId);
  const remoteReady = Boolean(remoteSession && (remoteSession.state === 'ready' || remoteSession.state === 'agent_locked'));

  useEffect(() => {
    pathRef.current = '';
    remotePathRef.current = '';
    setPathValue('');
    setSource('project');
    setEntries(rootFiles);
    setRemoteEntries([]);
    setLoading(false);
    setRemoteLoading(false);
    setError('');
  }, [session?.id]);

  useEffect(() => {
    if (pathRef.current === '') setEntries(rootFiles);
  }, [rootFiles]);

  const refreshDirectory = useCallback(async (nextPath: string, navigate: boolean) => {
    const requestedSessionId = session?.id;
    if (!requestedSessionId) return;
    const sequence = ++refreshSequenceRef.current;
    if (navigate) {
      pathRef.current = nextPath;
      setPathValue(nextPath);
      setLoading(true);
    }
    try {
      const nextEntries = await loadFiles(nextPath);
      if (sequence !== refreshSequenceRef.current || useSessionStore.getState().currentSession?.id !== requestedSessionId || pathRef.current !== nextPath) return;
      setEntries(nextEntries);
      setLoading(false);
    } catch (reason) {
      if (sequence === refreshSequenceRef.current) { setLoading(false); setError(errorMessage(reason)); }
    }
  }, [loadFiles, session?.id]);

  const refreshRemoteDirectory = useCallback(async (requestedPath?: string, navigate = true) => {
    const projectId = session?.id;
    const requestedSessionId = remoteSessionId;
    if (!projectId || !requestedSessionId) return;
    const sequence = ++remoteSequenceRef.current;
    if (navigate) setRemoteLoading(true);
    try {
      const nextPath = requestedPath || await window.hexestra.invoke<string>(SHELL_IPC.FILE_HOME, projectId, requestedSessionId);
      const nextEntries = await window.hexestra.invoke<ShellRemoteFileEntry[]>(SHELL_IPC.FILE_LIST, projectId, requestedSessionId, nextPath);
      if (sequence !== remoteSequenceRef.current || useSessionStore.getState().currentSession?.id !== projectId || remoteSourceRef.current !== requestedSessionId) return;
      remotePathRef.current = nextPath;
      setPathValue(nextPath);
      setRemoteEntries(nextEntries);
      setRemoteLoading(false);
      setError('');
    } catch (reason) {
      if (sequence === remoteSequenceRef.current) { setRemoteLoading(false); setError(errorMessage(reason)); }
    }
  }, [remoteSessionId, session?.id]);

  useEffect(() => {
    if (!window.hexestra || !session?.id) return;
    let active = true;
    const refreshSessions = () => {
      void Promise.resolve(window.hexestra.invoke<ShellSession[]>(SHELL_IPC.SESSION_LIST, session.id))
        .then((next) => { if (active && Array.isArray(next)) setRemoteSessions(next); })
        .catch(() => undefined);
    };
    refreshSessions();
    const removeChanged = window.hexestra.on(SHELL_IPC.CHANGED, (payload: unknown) => { if (isShellChangedForProject(payload, session.id)) refreshSessions(); });
    return () => { active = false; removeChanged(); };
  }, [session?.id]);

  useEffect(() => {
    ++remoteSequenceRef.current;
    if (source === 'project') return;
    remotePathRef.current = '';
    setPathValue('');
    setRemoteEntries([]);
    if (remoteReady) void refreshRemoteDirectory();
  }, [refreshRemoteDirectory, remoteReady, source]);

  useEffect(() => {
    if (!window.hexestra || !session?.id) return;
    return window.hexestra.on('session:data-changed', (payload: unknown) => {
      if (!isSessionDataChangedEvent(payload) || payload.sessionId !== session.id || !payload.files) return;
      if (source === 'project' && pathRef.current) void refreshDirectory(pathRef.current, false);
    });
  }, [refreshDirectory, session?.id, source]);

  useEffect(() => {
    if (!window.hexestra || !session?.id || !remoteSessionId) return;
    return window.hexestra.on(SHELL_IPC.FILE_CHANGED, (payload: unknown) => {
      if (isRemoteFileChangedForPath(payload, session.id, remoteSessionId)) void refreshRemoteDirectory(remotePathRef.current || undefined, false);
    });
  }, [refreshRemoteDirectory, remoteSessionId, session?.id]);

  useEffect(() => {
    if (!window.hexestra || !session?.id) return;
    return window.hexestra.on(SHELL_IPC.FILE_TRANSFER, (payload: unknown) => {
      if (isTransferForSession(payload, session.id, remoteSessionId)) setTransfer(payload);
    });
  }, [remoteSessionId, session?.id]);

  const openDirectory = useCallback((nextPath: string) => {
    if (source === 'project') void refreshDirectory(nextPath, true);
    else if (remoteReady) void refreshRemoteDirectory(nextPath, true);
  }, [refreshDirectory, refreshRemoteDirectory, remoteReady, source]);

  const openRemoteFile = useCallback(async (entry: ShellRemoteFileEntry) => {
    if (!session?.id || !remoteSessionId || !remoteReady) return;
    try {
      const file = await window.hexestra.invoke<ShellRemoteFileContent>(SHELL_IPC.FILE_READ, session.id, remoteSessionId, entry.path);
      if (file.binary) { setError('Binary remote files cannot be opened in the text editor; use Download instead.'); return; }
      openTab({ type: 'editor', title: entry.name, icon: 'file', closable: true, transient: true, data: { fileSource: 'remote', projectId: session.id, shellSessionId: remoteSessionId, filePath: entry.path, contentPreview: file.content ?? '', modifiedAt: file.modifiedAt, remoteRevision: file.revision } });
    } catch (reason) { setError(errorMessage(reason)); }
  }, [openTab, remoteReady, remoteSessionId, session?.id]);

  const createRemoteEntry = useCallback(async (kind: 'file' | 'directory') => {
    if (!session?.id || !remoteSessionId || !remoteReady) return;
    const name = window.prompt(kind === 'file' ? 'New file name' : 'New directory name');
    if (!name?.trim()) return;
    const trimmedName = name.trim();
    if (trimmedName === '.' || trimmedName === '..' || /[\\/\0]/.test(trimmedName)) { setError('Remote names must be a single path component.'); return; }
    const target = `${remotePathRef.current || '/'}${remotePathRef.current === '/' ? '' : '/'}${trimmedName}`;
    try {
      if (kind === 'file') await window.hexestra.invoke(SHELL_IPC.FILE_WRITE, session.id, remoteSessionId, target, '', undefined, false);
      else await window.hexestra.invoke(SHELL_IPC.FILE_MKDIR, session.id, remoteSessionId, target);
      await refreshRemoteDirectory(remotePathRef.current || undefined, false);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [refreshRemoteDirectory, remoteReady, remoteSessionId, session?.id]);

  const renameRemoteEntry = useCallback(async (entry: ShellRemoteFileEntry) => {
    if (!session?.id || !remoteSessionId || !remoteReady) return;
    const name = window.prompt('Rename remote item', entry.name);
    if (!name?.trim() || name.trim() === entry.name) return;
    const trimmedName = name.trim();
    if (trimmedName === '.' || trimmedName === '..' || /[\\/\0]/.test(trimmedName)) { setError('Remote names must be a single path component.'); return; }
    const target = `${remotePathRef.current || '/'}${remotePathRef.current === '/' ? '' : '/'}${trimmedName}`;
    try { await window.hexestra.invoke(SHELL_IPC.FILE_RENAME, session.id, remoteSessionId, entry.path, target); await refreshRemoteDirectory(remotePathRef.current || undefined, false); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [refreshRemoteDirectory, remoteReady, remoteSessionId, session?.id]);

  const deleteRemoteEntry = useCallback(async (entry: ShellRemoteFileEntry) => {
    if (!session?.id || !remoteSessionId || !remoteReady) return;
    try {
      const preview = await window.hexestra.invoke<ShellRemoteDeletePreview>(SHELL_IPC.FILE_DELETE_PREVIEW, session.id, remoteSessionId, entry.path);
      const approved = await confirm({ title: preview.recursive ? 'Delete remote directory recursively?' : 'Delete remote item?', description: `${preview.path}\n${preview.entries} item(s), ${formatBytes(preview.bytes)}`, tone: 'danger' });
      if (!approved) return;
      await window.hexestra.invoke(SHELL_IPC.FILE_DELETE, session.id, remoteSessionId, preview.token, preview.recursive);
      await refreshRemoteDirectory(remotePathRef.current || undefined, false);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [confirm, refreshRemoteDirectory, remoteReady, remoteSessionId, session?.id]);

  const uploadRemote = useCallback(async () => {
    if (!session?.id || !remoteSessionId || !remoteReady) return;
    try {
      const plan = await window.hexestra.invoke<ShellRemoteUploadPlan | { canceled: true }>(SHELL_IPC.FILE_UPLOAD_PICK, session.id, remoteSessionId, remotePathRef.current || '/');
      if (!plan || 'canceled' in plan) return;
      const conflicts = plan.files.filter((file) => file.conflict);
      const overwrite = conflicts.length > 0 ? await confirm({ title: 'Overwrite remote files?', description: conflicts.map((file) => file.name).join(', '), tone: 'danger' }) : false;
      if (conflicts.length > 0 && !overwrite) return;
      await window.hexestra.invoke(SHELL_IPC.FILE_UPLOAD_START, session.id, remoteSessionId, plan.selectionId, overwrite);
      await refreshRemoteDirectory(remotePathRef.current || undefined, false);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [confirm, refreshRemoteDirectory, remoteReady, remoteSessionId, session?.id]);

  const downloadRemote = useCallback(async (entry: ShellRemoteFileEntry) => {
    if (!session?.id || !remoteSessionId || !remoteReady || entry.type !== 'file') return;
    try { await window.hexestra.invoke(SHELL_IPC.FILE_DOWNLOAD, session.id, remoteSessionId, entry.path); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [remoteReady, remoteSessionId, session?.id]);

  if (!session) return <EmptyFiles message="Open a project folder to browse its evidence files." />;

  const parent = pathValue.includes('/') ? pathValue.slice(0, pathValue.lastIndexOf('/')) || '/' : '';
  const remoteSources = remoteSessions.filter((candidate) => candidate.kind === 'ssh'
    && candidate.capabilities.fileAccess === 'sftp'
    && candidate.state !== 'closed'
    && (candidate.state === 'ready' || candidate.state === 'agent_locked' || candidate.id === remoteSessionId));
  const showingRemote = source !== 'project';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-border-subtle bg-panel/40 px-2 py-1.5">
        <label className="flex items-center gap-2 text-[11px] text-text-muted"><span>Source</span><select aria-label="File source" value={source} onChange={(event) => setSource(event.target.value)} className="ui-control min-w-0 flex-1 px-1.5 py-0.5 text-[11px]"><option value="project">Project</option>{remoteSources.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · SSH</option>)}</select></label>
        {showingRemote && <div className="flex items-center gap-1"><button aria-label="Remote home" title="Home" onClick={() => void refreshRemoteDirectory(undefined, true)} className="ui-icon-button h-6 w-6" disabled={!remoteReady}><Icon name="home" size={12} /></button><button aria-label="Parent directory" title="Parent directory" onClick={() => void openDirectory(parent)} className="ui-icon-button h-6 w-6" disabled={!remoteReady || pathValue === '/'}><Icon name="chevron-right" size={12} className="rotate-180" /></button><button aria-label="Refresh remote directory" title="Refresh" onClick={() => void refreshRemoteDirectory(remotePathRef.current || undefined, false)} className="ui-icon-button h-6 w-6" disabled={!remoteReady}><Icon name="refresh" size={12} /></button><input aria-label="Remote absolute path" value={pathValue} placeholder="/absolute/path" onChange={(event) => setPathValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { if (pathValue.startsWith('/')) void openDirectory(pathValue); else setError('Remote paths must be absolute.'); } }} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-mono text-[11px] text-accent-teal outline-none focus:border-border-subtle" disabled={!remoteReady} /><button aria-label="New remote file" title="New file" onClick={() => void createRemoteEntry('file')} className="ui-icon-button h-6 w-6" disabled={!remoteReady}><Icon name="plus" size={12} /></button><button aria-label="New remote directory" title="New directory" onClick={() => void createRemoteEntry('directory')} className="ui-icon-button h-6 w-6" disabled={!remoteReady}><Icon name="folder" size={12} /></button><button aria-label="Upload files" title="Upload files" onClick={() => void uploadRemote()} className="ui-icon-button h-6 w-6" disabled={!remoteReady}><Icon name="upload" size={12} /></button></div>}
      </div>
      {showingRemote && !remoteReady && <div className="border-b border-status-warning/30 bg-status-warning/8 px-3 py-2 text-[11px] text-status-warning">SSH session is disconnected or not ready. Remote buffers remain available but saving is disabled.</div>}
      {error && <button type="button" role="alert" onClick={() => setError('')} className="border-b border-status-error/30 bg-status-error/8 px-3 py-1.5 text-left text-[11px] text-status-error" title="Dismiss error">{error}</button>}
      {transfer && <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-border-subtle px-3 py-1 text-[11px] text-text-muted"><span className="min-w-0 flex-1 truncate">{transfer.status === 'running' ? `${transfer.direction} · ${transfer.name}` : `${transfer.direction} ${transfer.status}`}</span>{transfer.status === 'running' && <><span className="font-mono">{formatBytes(transfer.transferred)} / {formatBytes(transfer.total)}</span><button type="button" aria-label="Cancel transfer" title="Cancel transfer" onClick={() => { if (session?.id && remoteSessionId) void window.hexestra.invoke(SHELL_IPC.FILE_TRANSFER_CANCEL, session.id, remoteSessionId, transfer.transferId); }} className="rounded px-1 text-status-warning hover:bg-raised">Cancel</button></>}</div>}
      {!showingRemote && <><div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-subtle px-2 text-2xs text-text-muted">{pathValue && <button aria-label="Parent directory" onClick={() => void openDirectory(parent)} className="ui-icon-button p-1"><Icon name="chevron-right" size={12} className="rotate-180" /></button>}<button onClick={() => void openDirectory('')} className="truncate rounded px-1 py-0.5 hover:bg-raised hover:text-text-primary">{session.name}</button>{pathValue && <span className="truncate font-mono text-accent-teal">/{pathValue}</span>}</div><div className="min-h-0 flex-1 overflow-y-auto py-1">{loading && <p className="px-3 py-2 text-2xs text-text-muted">Loading…</p>}{!loading && entries.length === 0 && <p className="px-3 py-3 text-2xs text-text-muted">This folder is empty.</p>}{!loading && entries.map((entry) => <button key={entry.path} onClick={() => entry.type === 'directory' ? void openDirectory(entry.path) : openTab({ type: 'editor', title: entry.name, icon: 'file', closable: true, data: { filePath: entry.path, sessionId: session.id } })} className="ui-hover-row mx-1.5 my-0.5 flex w-[calc(100%-0.75rem)] items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary"><Icon name={entry.type === 'directory' ? 'folder' : 'file'} size={14} className={entry.type === 'directory' ? 'text-accent-blue' : 'text-text-muted'} /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.type === 'file' && <span className="text-[11px] text-text-muted">{formatBytes(entry.size)}</span>}</button>)}</div></>}
      {showingRemote && <div className="min-h-0 flex-1 overflow-y-auto py-1">{remoteLoading && <p className="px-3 py-2 text-2xs text-text-muted">Loading remote directory…</p>}{!remoteLoading && remoteEntries.length === 0 && remoteReady && <p className="px-3 py-3 text-2xs text-text-muted">This remote folder is empty.</p>}{!remoteLoading && remoteEntries.map((entry) => <div key={entry.path} className="ui-hover-row group mx-1.5 my-0.5 flex min-w-0 items-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary"><button type="button" aria-label={`Open ${entry.name}`} onClick={() => entry.type === 'directory' ? void openDirectory(entry.path) : void openRemoteFile(entry)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><Icon name={entry.type === 'directory' ? 'folder' : entry.type === 'symlink' ? 'network' : 'file'} size={14} className={entry.type === 'directory' ? 'text-accent-blue' : entry.type === 'symlink' ? 'text-accent-teal' : 'text-text-muted'} /><span className="min-w-0 flex-1 truncate" title={entry.path}>{entry.name}</span><span className="shrink-0 text-[11px] text-text-muted">{entry.type === 'file' || entry.type === 'symlink' ? formatBytes(entry.size) : ''}</span></button><div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{entry.type === 'file' && <button type="button" aria-label={`Download ${entry.name}`} title="Download" onClick={() => void downloadRemote(entry)} className="ui-icon-button h-6 w-6"><Icon name="download" size={11} /></button>}<button type="button" aria-label={`Rename ${entry.name}`} title="Rename" onClick={() => void renameRemoteEntry(entry)} className="ui-icon-button h-6 w-6"><Icon name="edit" size={11} /></button><button type="button" aria-label={`Delete ${entry.name}`} title="Delete" onClick={() => void deleteRemoteEntry(entry)} className="ui-icon-button h-6 w-6 text-status-error"><Icon name="trash" size={11} /></button></div></div>)}</div>}
    </div>
  );
}

function EmptyFiles({ message }: { message: string }) { return <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-2xs text-text-muted"><Icon name="folder" size={24} /><p>{message}</p></div>; }
function formatBytes(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
function isShellChangedForProject(payload: unknown, projectId: string) { return Boolean(payload && typeof payload === 'object' && (payload as { projectId?: unknown }).projectId === projectId); }
function isRemoteFileChangedForPath(payload: unknown, projectId: string, sessionId: string) { return Boolean(payload && typeof payload === 'object' && (payload as { projectId?: unknown; sessionId?: unknown }).projectId === projectId && (payload as { sessionId?: unknown }).sessionId === sessionId); }
function isTransferForSession(payload: unknown, projectId: string, sessionId?: string): payload is ShellFileTransferEvent { return Boolean(payload && typeof payload === 'object' && (payload as ShellFileTransferEvent).projectId === projectId && (!sessionId || (payload as ShellFileTransferEvent).sessionId === sessionId)); }
