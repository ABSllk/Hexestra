import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Icon } from '@/components/shared';
import { MarkdownContent } from '@/components/right-panel/AgentTimelineMessage';
import { detectEditorLanguage, isMarkdownPath } from '@/lib/editorLanguage';
import { APP_CODE_FONT_SIZE_PX, getMonoFontFamily } from '@/lib/typography';
import { prepareMonaco } from '@/lib/monaco';
import { MONACO_THEME_NAMES } from '@/lib/theme';
import { useAppPreferences } from '@/i18n';
import { useSessionStore, useTabStore } from '@/stores';
import type { SessionFileContent } from '@/types';
import { SHELL_IPC, type ShellRemoteFileContent, type ShellSession } from '@electron/contracts/shell';
import { eventMatchesShortcut, resolveShortcutBinding } from '@electron/contracts/shortcuts';

type RemoteWriteResult = ShellRemoteFileContent | {
  status: 'conflict';
  currentRevision: string;
  currentModifiedAt: string;
};

export function EditorTab({ tabId }: { tabId: string }) {
  const { resolvedTheme, settings, platform } = useAppPreferences();
  const tab = useTabStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const updateTabTitle = useTabStore((state) => state.updateTabTitle);
  const updateTabData = useTabStore((state) => state.updateTabData);
  const activeSessionId = useSessionStore((state) => state.currentSession?.id);
  const remoteFile = tab?.data?.fileSource === 'remote';
  const filePath = tab?.data?.filePath as string | undefined;
  const sessionId = (tab?.data?.sessionId as string | undefined) ?? activeSessionId;
  const projectId = tab?.data?.projectId as string | undefined;
  const shellSessionId = tab?.data?.shellSessionId as string | undefined;
  const initialContent = typeof tab?.data?.contentPreview === 'string' ? tab.data.contentPreview : undefined;
  const [content, setContent] = useState(() => getDefaultContent(filePath, initialContent));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error' | 'disconnected' | 'conflict'>('ready');
  const [remoteAvailable, setRemoteAvailable] = useState(!remoteFile);
  const [remoteRevision, setRemoteRevision] = useState(() => tab?.data?.remoteRevision as string | undefined);
  const [conflictRevision, setConflictRevision] = useState<string | undefined>();
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>(() => (
    isMarkdownPath(filePath) ? 'preview' : 'source'
  ));
  const contentRef = useRef(content);

  useEffect(() => {
    setMarkdownMode(isMarkdownPath(filePath) ? 'preview' : 'source');
  }, [filePath]);

  const refreshRemoteAvailability = useCallback(async () => {
    if (!remoteFile || !projectId || !shellSessionId || !window.hexestra) return false;
    try {
      const sessions = await window.hexestra.invoke<ShellSession[]>(SHELL_IPC.SESSION_LIST, projectId);
      const remoteSession = sessions.find((candidate) => candidate.id === shellSessionId);
      const available = Boolean(
        remoteSession
        && remoteSession.kind === 'ssh'
        && remoteSession.capabilities.fileAccess === 'sftp'
        && (remoteSession.state === 'ready' || remoteSession.state === 'agent_locked'),
      );
      setRemoteAvailable(available);
      if (available) setStatus((current) => current === 'disconnected' ? 'ready' : current);
      else setStatus((current) => current === 'loading' || current === 'saving' ? current : 'disconnected');
      return available;
    } catch {
      setRemoteAvailable(false);
      setStatus((current) => current === 'loading' || current === 'saving' ? current : 'disconnected');
      return false;
    }
  }, [projectId, remoteFile, shellSessionId]);

  useEffect(() => {
    if (!filePath || !window.hexestra) return;
    let cancelled = false;
    setStatus('loading');
    const read = async () => {
      if (remoteFile) {
        if (!projectId || !shellSessionId || !(await refreshRemoteAvailability())) {
          if (!cancelled) setStatus('disconnected');
          return;
        }
        const file = await window.hexestra.invoke<ShellRemoteFileContent>(SHELL_IPC.FILE_READ, projectId, shellSessionId, filePath);
        if (cancelled) return;
        if (file.binary || typeof file.content !== 'string') throw new Error('Binary remote files can only be downloaded');
        setContent(file.content);
        contentRef.current = file.content;
        setRemoteRevision(file.revision);
        setConflictRevision(undefined);
        updateTabData(tabId, { contentPreview: file.content, modifiedAt: file.modifiedAt, remoteRevision: file.revision });
        setDirty(false);
        setStatus('ready');
        return;
      }
      if (!sessionId) return;
      const file = await window.hexestra.invoke<SessionFileContent>('files:read', sessionId, filePath);
      if (cancelled) return;
      setContent(file.content);
      contentRef.current = file.content;
      updateTabData(tabId, { contentPreview: file.content, modifiedAt: file.modifiedAt });
      setDirty(false);
      setStatus('ready');
    };
    void read().catch(() => !cancelled && setStatus(remoteFile ? 'disconnected' : 'error'));
    return () => { cancelled = true; };
  }, [filePath, projectId, refreshRemoteAvailability, remoteFile, sessionId, shellSessionId, tabId, updateTabData]);

  useEffect(() => {
    if (!remoteFile || !projectId || !shellSessionId || !window.hexestra) return;
    const onChanged = (payload: unknown) => {
      const event = payload as { projectId?: string; sessionId?: string };
      if (event.projectId === projectId && (!event.sessionId || event.sessionId === shellSessionId)) void refreshRemoteAvailability();
    };
    const removeShellChanged = window.hexestra.on(SHELL_IPC.CHANGED, onChanged);
    const removeFileChanged = window.hexestra.on(SHELL_IPC.FILE_CHANGED, (payload: unknown) => {
      const event = payload as { projectId?: string; sessionId?: string };
      if (event.projectId === projectId && event.sessionId === shellSessionId) void refreshRemoteAvailability();
    });
    return () => { removeShellChanged?.(); removeFileChanged?.(); };
  }, [projectId, refreshRemoteAvailability, remoteFile, shellSessionId]);

  const save = useCallback(async () => {
    if (!filePath || !window.hexestra || (remoteFile ? !projectId || !shellSessionId || !remoteAvailable : !sessionId)) return;
    setStatus('saving');
    try {
      if (remoteFile) {
        const file = await window.hexestra.invoke<RemoteWriteResult>(SHELL_IPC.FILE_WRITE, projectId, shellSessionId, filePath, contentRef.current, remoteRevision, false);
        if ('status' in file && file.status === 'conflict') {
          setConflictRevision(file.currentRevision);
          setStatus('conflict');
          return;
        }
        if (!('revision' in file)) throw new Error('Remote write returned no revision');
        setRemoteRevision(file.revision);
        updateTabData(tabId, { contentPreview: contentRef.current, modifiedAt: file.modifiedAt, remoteRevision: file.revision });
      } else {
        const file = await window.hexestra.invoke<SessionFileContent>('files:write', sessionId, filePath, contentRef.current);
        updateTabData(tabId, { contentPreview: contentRef.current, modifiedAt: file.modifiedAt });
      }
      setConflictRevision(undefined);
      setDirty(false);
      setStatus('ready');
    } catch {
      setStatus(remoteFile ? 'disconnected' : 'error');
    }
  }, [filePath, projectId, remoteAvailable, remoteFile, remoteRevision, sessionId, shellSessionId, tabId, updateTabData]);

  const reloadRemote = useCallback(async () => {
    if (!remoteFile || !projectId || !shellSessionId || !filePath || !remoteAvailable || !window.hexestra) return;
    setStatus('loading');
    try {
      const file = await window.hexestra.invoke<ShellRemoteFileContent>(SHELL_IPC.FILE_READ, projectId, shellSessionId, filePath);
      if (file.binary || typeof file.content !== 'string') throw new Error('Binary remote files can only be downloaded');
      setContent(file.content);
      contentRef.current = file.content;
      setRemoteRevision(file.revision);
      setConflictRevision(undefined);
      updateTabData(tabId, { contentPreview: file.content, modifiedAt: file.modifiedAt, remoteRevision: file.revision });
      setDirty(false);
      setStatus('ready');
    } catch {
      setStatus('disconnected');
    }
  }, [filePath, projectId, remoteAvailable, remoteFile, shellSessionId, tabId, updateTabData]);

  const forceSaveRemote = useCallback(async () => {
    if (!remoteFile || !filePath || !projectId || !shellSessionId || !remoteAvailable || !window.hexestra) return;
    setStatus('saving');
    try {
      const file = await window.hexestra.invoke<ShellRemoteFileContent>(SHELL_IPC.FILE_WRITE, projectId, shellSessionId, filePath, contentRef.current, conflictRevision ?? remoteRevision, true);
      setRemoteRevision(file.revision);
      setConflictRevision(undefined);
      updateTabData(tabId, { contentPreview: contentRef.current, modifiedAt: file.modifiedAt, remoteRevision: file.revision });
      setDirty(false);
      setStatus('ready');
    } catch {
      setStatus('disconnected');
    }
  }, [conflictRevision, filePath, projectId, remoteFile, remoteAvailable, remoteRevision, shellSessionId, tabId, updateTabData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (eventMatchesShortcut(event, resolveShortcutBinding(settings.shortcutOverrides, 'editor.save'), platform)) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [platform, save, settings.shortcutOverrides]);

  const handleMount: OnMount = (editor, editorApi) => {
    prepareMonaco(editorApi, resolvedTheme);
    editor.focus();
  };

  const isMarkdown = isMarkdownPath(filePath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-panel/60 px-2 text-2xs text-text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{filePath ?? 'Untitled'}</span>
        {isMarkdown && (
          <div className="flex rounded border border-border-subtle bg-panel/50 p-0.5" aria-label="Markdown view">
            {(['preview', 'source'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={markdownMode === mode}
                onClick={() => setMarkdownMode(mode)}
                className={`rounded px-2 py-0.5 capitalize ${
                  markdownMode === mode
                    ? 'bg-raised text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
        <span role="status" aria-live="polite">{status === 'loading' ? 'Loading…' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Error' : status === 'disconnected' ? 'SSH disconnected' : status === 'conflict' ? 'Remote changed' : dirty ? 'Modified' : 'Saved'}</span>
        {filePath && (
          <button aria-label="Save file" title="Save (Ctrl+S)" onClick={() => void save()} disabled={status === 'saving' || (remoteFile && !remoteAvailable)} className="rounded p-1 hover:bg-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40">
            <Icon name="check" size={13} />
          </button>
        )}
      </div>
      {remoteFile && status === 'disconnected' && <div className="border-b border-status-warning/30 bg-status-warning/8 px-3 py-1.5 text-[11px] text-status-warning">SSH session disconnected. Your buffer is preserved; reconnect the same session to save.</div>}
      {remoteFile && status === 'conflict' && <div className="flex items-center gap-2 border-b border-status-warning/30 bg-status-warning/8 px-3 py-1.5 text-[11px] text-status-warning"><span className="min-w-0 flex-1">The remote file changed since it was opened. Reload it or force-overwrite the newer revision.</span><button type="button" onClick={() => void reloadRemote()} className="rounded border border-border-subtle px-1.5 py-0.5 hover:bg-raised">Reload</button><button type="button" onClick={() => void forceSaveRemote()} className="rounded border border-status-warning/50 px-1.5 py-0.5 hover:bg-raised">Force overwrite</button></div>}
      <div className="min-h-0 flex-1">
        {isMarkdown && markdownMode === 'preview' ? (
          <div className="h-full overflow-y-auto bg-panel px-6 py-5 text-sm leading-6 text-text-secondary">
            <MarkdownContent content={content || '_Empty Markdown file_'} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={detectEditorLanguage(filePath)}
            value={content}
            theme={MONACO_THEME_NAMES[resolvedTheme]}
            onMount={handleMount}
            onChange={(value = '') => {
              setContent(value);
              contentRef.current = value;
              setDirty(true);
              updateTabData(tabId, { contentPreview: value });
              if (filePath) updateTabTitle(tabId, `${filePath.split('/').pop()} •`);
            }}
            options={{ fontFamily: getMonoFontFamily(), fontSize: APP_CODE_FONT_SIZE_PX, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, padding: { top: 8 } }}
          />
        )}
      </div>
    </div>
  );
}

function getDefaultContent(filePath?: string, initialContent?: string) {
  if (initialContent !== undefined) return initialContent;
  if (!filePath) return '# Notes\n\n';
  return '';
}
