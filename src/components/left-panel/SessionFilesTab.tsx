import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { useSessionStore, useTabStore } from '@/stores';
import type { SessionFileEntry } from '@/types';
import { isSessionDataChangedEvent } from '@electron/contracts/session';

export function SessionFilesTab() {
  const session = useSessionStore((state) => state.currentSession);
  const rootFiles = useSessionStore((state) => state.files);
  const loadFiles = useSessionStore((state) => state.loadFiles);
  const openTab = useTabStore((state) => state.openTab);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<SessionFileEntry[]>(rootFiles);
  const [loading, setLoading] = useState(false);
  const pathRef = useRef('');
  const refreshSequenceRef = useRef(0);

  useEffect(() => {
    pathRef.current = '';
    setPath('');
    setEntries(rootFiles);
    setLoading(false);
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
      setPath(nextPath);
      setLoading(true);
    }
    const nextEntries = await loadFiles(nextPath);
    if (
      sequence !== refreshSequenceRef.current
      || useSessionStore.getState().currentSession?.id !== requestedSessionId
      || pathRef.current !== nextPath
    ) return;
    setEntries(nextEntries);
    setLoading(false);
  }, [loadFiles, session?.id]);

  const openDirectory = useCallback((nextPath: string) => (
    refreshDirectory(nextPath, true)
  ), [refreshDirectory]);

  useEffect(() => {
    if (!window.hexestra || !session?.id) return;
    return window.hexestra.on('session:data-changed', (payload: unknown) => {
      if (!isSessionDataChangedEvent(payload) || payload.sessionId !== session.id || !payload.files) return;
      const currentPath = pathRef.current;
      if (currentPath) void refreshDirectory(currentPath, false);
    });
  }, [refreshDirectory, session?.id]);

  if (!session) {
    return <EmptyFiles message="Open a project folder to browse its evidence files." />;
  }

  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-surface px-2 text-2xs text-text-muted">
        {path && (
          <button aria-label="Parent directory" onClick={() => void openDirectory(parent)} className="ui-icon-button p-1">
            <Icon name="chevron-right" size={12} className="rotate-180" />
          </button>
        )}
        <button onClick={() => void openDirectory('')} className="truncate rounded px-1 py-0.5 hover:bg-surface hover:text-text-primary">
          {session.name}
        </button>
        {path && <span className="truncate font-mono text-accent-teal">/{path}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && <p className="px-3 py-2 text-2xs text-text-muted">Loading…</p>}
        {!loading && entries.length === 0 && <p className="px-3 py-3 text-2xs text-text-muted">This folder is empty.</p>}
        {!loading && entries.map((entry) => (
          <button
            key={entry.path}
            onClick={() => {
              if (entry.type === 'directory') void openDirectory(entry.path);
              else openTab({
                type: 'editor',
                title: entry.name,
                icon: 'file',
                closable: true,
                data: { filePath: entry.path, sessionId: session.id },
              });
            }}
            className="ui-hover-row mx-1.5 my-0.5 flex w-[calc(100%-0.75rem)] items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary"
          >
            <Icon name={entry.type === 'directory' ? 'folder' : 'file'} size={14} className={entry.type === 'directory' ? 'text-accent-blue' : 'text-text-muted'} />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {entry.type === 'file' && <span className="text-[9px] text-text-muted">{formatBytes(entry.size)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyFiles({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-2xs text-text-muted">
      <Icon name="folder" size={24} />
      <p>{message}</p>
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}
