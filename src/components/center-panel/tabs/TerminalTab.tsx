import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, useConfirmDialog } from '@/components/shared';
import { useTerminal } from '@/hooks/useTerminal';
import { appendTerminalContext } from '@/lib/terminalText';
import { useNetMapStore, useSessionStore, useTabStore } from '@/stores';
import { SHELL_IPC, type ShellProfile, type ShellSession } from '@electron/contracts/shell';

interface TerminalTabProps {
  tabId: string;
}

export function TerminalTab({ tabId }: TerminalTabProps) {
  const confirm = useConfirmDialog();
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef('');
  const updateFrameRef = useRef<number | null>(null);
  const updateTabData = useTabStore((state) => state.updateTabData);
  const tab = useTabStore((state) => state.tabs?.find((candidate) => candidate.id === tabId));
  const sessionId = useSessionStore((state) => state.currentSession?.id);
  const shellProfileId = typeof tab?.data?.shellProfileId === 'string' ? tab.data.shellProfileId : undefined;
  const shellSessionId = typeof tab?.data?.shellSessionId === 'string' ? tab.data.shellSessionId : undefined;
  const managedShell = tab?.data?.managedShell === true || Boolean(shellProfileId || shellSessionId);
  const selectedNodeId = useNetMapStore((state) => state.selectedNodeId);
  const [hasSelection, setHasSelection] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [shellSession, setShellSession] = useState<ShellSession | null>(null);
  const [shellLookupComplete, setShellLookupComplete] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const shellSessionUnavailable = Boolean(
    managedShell
    && shellLookupComplete
    && (
      !shellSessionId
      || !shellSession
      || shellSession.state === 'disconnected'
      || shellSession.state === 'failed'
      || shellSession.state === 'closed'
    ),
  );
  const shellSessionUnavailableMessage = shellProfileId
    ? 'This Shell is disconnected.'
    : shellSession
      ? 'This reverse Shell is disconnected.'
      : 'This reverse Shell session expired when Hexestra closed.';

  const handleOutput = useCallback((data: string) => {
    outputRef.current = appendTerminalContext(outputRef.current, data);
    if (updateFrameRef.current === null) {
      updateFrameRef.current = requestAnimationFrame(() => {
        updateFrameRef.current = null;
        updateTabData(tabId, { contentPreview: outputRef.current });
      });
    }
  }, [tabId, updateTabData]);

  const terminal = useTerminal(containerRef, {
    disabled: Boolean(managedShell && (!shellLookupComplete || shellSessionUnavailable)),
    onOutput: handleOutput,
    onSelectionChange: setHasSelection,
    engagementId: sessionId,
    activeTargetId: selectedNodeId ?? undefined,
    ownerId: tabId,
    shellSessionId,
  });

  const refreshShellSession = useCallback(async () => {
    if (!sessionId || !shellSessionId) {
      setShellSession(null);
      setShellLookupComplete(true);
      return;
    }
    try {
      const sessions = await window.hexestra.invoke<ShellSession[]>(SHELL_IPC.SESSION_LIST, sessionId);
      setShellSession(sessions.find((item) => item.id === shellSessionId) ?? null);
    } catch (error) {
      setShellSession(null);
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setShellLookupComplete(true);
    }
  }, [sessionId, shellSessionId]);

  useEffect(() => {
    setShellLookupComplete(false);
    void refreshShellSession();
    if (!window.hexestra) return;
    return window.hexestra.on(SHELL_IPC.CHANGED, (payload: unknown) => {
      const event = payload as { projectId?: string; sessionId?: string };
      if (event.projectId === sessionId && (!event.sessionId || event.sessionId === shellSessionId)) {
        void refreshShellSession();
      }
    });
  }, [refreshShellSession, sessionId, shellSessionId]);

  const connectProfile = useCallback(async () => {
    if (!sessionId || !shellProfileId) return;
    setConnecting(true);
    setConnectionError('');
    const connect = async () => window.hexestra.invoke<ShellSession>(
      SHELL_IPC.SESSION_CONNECT,
      sessionId,
      shellProfileId,
      tabId,
    );
    try {
      const connected = await connect();
      updateTabData(tabId, { shellSessionId: connected.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
        try {
          const profiles = await window.hexestra.invoke<ShellProfile[]>(SHELL_IPC.PROFILE_LIST, sessionId);
          const profile = profiles.find((item) => item.id === trustProfileId);
          if (!profile) throw new Error('Shell profile not found');
          await window.hexestra.invoke(SHELL_IPC.PROFILE_SAVE, sessionId, { ...profile, hostKeyFingerprint: fingerprint });
          const connected = await connect();
          updateTabData(tabId, { shellSessionId: connected.id });
        } catch (retryError) {
          setConnectionError(retryError instanceof Error ? retryError.message : String(retryError));
        }
      } else {
        setConnectionError(message);
      }
    } finally {
      setConnecting(false);
    }
  }, [confirm, sessionId, shellProfileId, tabId, updateTabData]);

  useEffect(() => () => {
    if (updateFrameRef.current !== null) cancelAnimationFrame(updateFrameRef.current);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!clipboardNotice) return;
    const timeout = window.setTimeout(() => setClipboardNotice(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [clipboardNotice]);

  const runClipboardAction = (
    action: () => boolean | Promise<boolean>,
    success: string,
    unavailable: string,
  ) => {
    setContextMenu(null);
    void Promise.resolve(action())
      .then((completed) => setClipboardNotice(completed ? success : unavailable))
      .catch((error: unknown) => {
        setClipboardNotice(error instanceof Error ? error.message : 'Clipboard action failed');
      });
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setContextMenu({
      x: Math.max(6, Math.min(event.clientX - bounds.left, bounds.width - 174)),
      y: Math.max(34, Math.min(event.clientY - bounds.top, bounds.height - 112)),
    });
  };

  return (
    <div
      ref={shellRef}
      className="terminal-shell relative flex h-full min-h-0 flex-col bg-panel"
      onContextMenu={handleContextMenu}
    >
      {managedShell && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-subtle bg-canvas px-2 text-[11px] text-text-muted">
          <Icon name="shield" size={12} className="text-accent-yellow" />
          <span className="truncate">Shared with AI · Agent commands and complete output are stored in plaintext</span>
          {shellSession?.state === 'agent_locked' && (
            <button className="ml-auto rounded border border-accent-yellow/40 px-2 py-0.5 text-accent-yellow" onClick={() => void terminal.takeover()}>
              Take over
            </button>
          )}
          {shellSession && <span className="ml-auto font-mono text-[11px] uppercase">{shellSession.state}</span>}
        </div>
      )}
      <div ref={containerRef} className="xterm-container min-h-0 flex-1" />
      {shellSessionUnavailable && (
        <div className="absolute inset-0 top-7 flex items-center justify-center bg-panel/95">
          <div className="max-w-sm text-center">
            <Icon name="terminal" size={28} className="mx-auto mb-3 text-accent-teal" />
            <p className="text-xs text-text-secondary">{shellSessionUnavailableMessage}</p>
            {connectionError && <p className="mt-2 break-words text-[11px] text-accent-red">{connectionError}</p>}
            {shellProfileId && <button
              type="button"
              disabled={connecting}
              onClick={() => void connectProfile()}
              className="mt-3 rounded border border-accent-teal/50 bg-accent-teal/10 px-3 py-1.5 text-[11px] text-accent-teal disabled:opacity-50"
            >
              {connecting ? 'Connecting…' : 'Reconnect'}
            </button>}
          </div>
        </div>
      )}
      {clipboardNotice && (
        <span className="pointer-events-none absolute right-2 top-2 z-40 rounded border border-border-subtle bg-canvas/95 px-2 py-1 text-[11px] text-accent-teal shadow-lg" role="status">
          {clipboardNotice}
        </span>
      )}
      {contextMenu && (
        <div
          role="menu"
          aria-label="Terminal context menu"
          className="absolute z-50 w-42 overflow-hidden rounded border border-border-subtle bg-canvas py-1 text-[11px] text-text-primary shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y, width: 168 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <TerminalMenuItem
            disabled={!hasSelection}
            icon="copy"
            label="Copy"
            shortcut="Ctrl+Shift+C"
            onClick={() => runClipboardAction(terminal.copySelection, 'Copied', 'Select text to copy')}
          />
          <TerminalMenuItem
            icon="paste"
            label="Paste"
            shortcut="Ctrl+Shift+V"
            onClick={() => runClipboardAction(terminal.pasteFromClipboard, 'Pasted', 'Clipboard is empty')}
          />
          <div className="my-1 h-px bg-raised/80" />
          <TerminalMenuItem
            icon="select-all"
            label="Select all"
            onClick={() => runClipboardAction(terminal.selectAll, 'Selected all', 'Nothing to select')}
          />
          {shellSessionId && (
            <>
              <div className="my-1 h-px bg-raised/80" />
              <TerminalMenuItem
                icon="pause"
                label="Take over / interrupt"
                onClick={() => runClipboardAction(async () => Boolean(await terminal.takeover()), 'Session released', 'No Agent command is active')}
              />
              <TerminalMenuItem
                icon="close"
                label="Disconnect"
                onClick={() => runClipboardAction(async () => {
                  const disconnected = Boolean(await terminal.disconnect());
                  if (disconnected) updateTabData(tabId, { shellSessionId: undefined });
                  return disconnected;
                }, 'Disconnected', 'Already disconnected')}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TerminalMenuItem({
  icon,
  label,
  shortcut,
  disabled = false,
  onClick,
}: {
  icon: 'copy' | 'paste' | 'select-all' | 'pause' | 'close';
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 px-2.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={13} />
      <span>{label}</span>
      {shortcut && <span className="ml-auto font-mono text-[11px] text-text-muted">{shortcut}</span>}
    </button>
  );
}
