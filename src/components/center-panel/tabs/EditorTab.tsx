import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { Icon } from '@/components/shared';
import { MarkdownContent } from '@/components/right-panel/AgentTimelineMessage';
import { detectEditorLanguage, isMarkdownPath } from '@/lib/editorLanguage';
import { getMonoFontFamily } from '@/lib/typography';
import { useSessionStore, useTabStore } from '@/stores';
import type { SessionFileContent } from '@/types';

// Keep the editor fully offline. @monaco-editor/react otherwise loads Monaco
// from a public CDN, which leaves the workspace stuck on "Loading…" in a
// restricted pentest environment.
loader.config({ monaco });

export function EditorTab({ tabId }: { tabId: string }) {
  const tab = useTabStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const updateTabTitle = useTabStore((state) => state.updateTabTitle);
  const updateTabData = useTabStore((state) => state.updateTabData);
  const activeSessionId = useSessionStore((state) => state.currentSession?.id);
  const filePath = tab?.data?.filePath as string | undefined;
  const sessionId = (tab?.data?.sessionId as string | undefined) ?? activeSessionId;
  const [content, setContent] = useState(() => getDefaultContent(filePath));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('ready');
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>(() => (
    isMarkdownPath(filePath) ? 'preview' : 'source'
  ));
  const contentRef = useRef(content);

  useEffect(() => {
    setMarkdownMode(isMarkdownPath(filePath) ? 'preview' : 'source');
  }, [filePath]);

  useEffect(() => {
    if (!filePath || !sessionId || !window.hexestra) return;
    let cancelled = false;
    setStatus('loading');
    void window.hexestra.invoke<SessionFileContent>('files:read', sessionId, filePath)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        contentRef.current = file.content;
        updateTabData(tabId, { contentPreview: file.content, modifiedAt: file.modifiedAt });
        setDirty(false);
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => { cancelled = true; };
  }, [filePath, sessionId, tabId, updateTabData]);

  const save = useCallback(async () => {
    if (!filePath || !sessionId || !window.hexestra) return;
    setStatus('saving');
    try {
      const file = await window.hexestra.invoke<SessionFileContent>('files:write', sessionId, filePath, contentRef.current);
      updateTabData(tabId, { contentPreview: contentRef.current, modifiedAt: file.modifiedAt });
      setDirty(false);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [filePath, sessionId, tabId, updateTabData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  const handleMount: OnMount = (editor, editorApi) => {
    editorApi.editor.defineTheme('hexestra-dark', {
      base: 'vs-dark', inherit: true,
      rules: [{ token: 'comment', foreground: '6c7086', fontStyle: 'italic' }],
      colors: { 'editor.background': '#1e1e2e', 'editorCursor.foreground': '#89b4fa' },
    });
    editorApi.editor.setTheme('hexestra-dark');
    editor.focus();
  };

  const isMarkdown = isMarkdownPath(filePath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-surface bg-bg-tertiary/60 px-2 text-2xs text-text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{filePath ?? 'Untitled'}</span>
        {isMarkdown && (
          <div className="flex rounded border border-surface bg-bg-primary/50 p-0.5" aria-label="Markdown view">
            {(['preview', 'source'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={markdownMode === mode}
                onClick={() => setMarkdownMode(mode)}
                className={`rounded px-2 py-0.5 capitalize ${
                  markdownMode === mode
                    ? 'bg-surface text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
        <span>{status === 'loading' ? 'Loading…' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Error' : dirty ? 'Modified' : 'Saved'}</span>
        {filePath && (
          <button aria-label="Save file" title="Save (Ctrl+S)" onClick={() => void save()} className="rounded p-1 hover:bg-surface hover:text-text-primary">
            <Icon name="check" size={13} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {isMarkdown && markdownMode === 'preview' ? (
          <div className="h-full overflow-y-auto bg-bg-primary px-6 py-5 text-sm leading-6 text-text-secondary">
            <MarkdownContent content={content || '_Empty Markdown file_'} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={detectEditorLanguage(filePath)}
            value={content}
            theme="hexestra-dark"
            onMount={handleMount}
            onChange={(value = '') => {
              setContent(value);
              contentRef.current = value;
              setDirty(true);
              updateTabData(tabId, { contentPreview: value });
              if (filePath) updateTabTitle(tabId, `${filePath.split('/').pop()} •`);
            }}
            options={{ fontFamily: getMonoFontFamily(), fontSize: 13, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, padding: { top: 8 } }}
          />
        )}
      </div>
    </div>
  );
}

function getDefaultContent(filePath?: string) {
  if (!filePath) return '# Notes\n\n';
  return '';
}
