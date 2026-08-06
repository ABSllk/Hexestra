import { useCallback, useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { terminalClipboardAction } from '@/lib/terminalClipboard';
import { APP_CODE_FONT_SIZE_PX, getMonoFontFamily } from '@/lib/typography';
import { useAppPreferences } from '@/i18n';
import { getTerminalTheme } from '@/lib/theme';
import { SHELL_IPC, type ShellSession } from '@electron/contracts/shell';

interface UseTerminalOptions {
  disabled?: boolean;
  onOutput?: (data: string) => void;
  onScrollChange?: (state: TerminalScrollState) => void;
  onSelectionChange?: (hasSelection: boolean) => void;
  engagementId?: string;
  activeTargetId?: string;
  ownerId?: string;
  shellSessionId?: string;
}

interface TerminalSessionLease {
  sessionId: string;
  title: string;
  leaseId?: string;
  managedShell?: boolean;
}

export interface TerminalScrollState {
  viewportY: number;
  baseY: number;
  isAtBottom: boolean;
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options?: UseTerminalOptions,
) {
  const { resolvedTheme } = useAppPreferences();
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionLeaseRef = useRef<TerminalSessionLease | null>(null);
  const onOutputRef = useRef(options?.onOutput);
  const onScrollChangeRef = useRef(options?.onScrollChange);
  const onSelectionChangeRef = useRef(options?.onSelectionChange);
  const activeTargetIdRef = useRef(options?.activeTargetId);
  onOutputRef.current = options?.onOutput;
  onScrollChangeRef.current = options?.onScrollChange;
  onSelectionChangeRef.current = options?.onSelectionChange;
  activeTargetIdRef.current = options?.activeTargetId;

  const createSession = useCallback(async (): Promise<TerminalSessionLease | null> => {
    if (options?.disabled) return null;
    if (!window.hexestra) {
      console.warn('[Terminal] Hexestra API is not available');
      return null;
    }
    if (options?.shellSessionId && options.engagementId && options.ownerId) {
      const session = await window.hexestra.invoke<ShellSession>(
        SHELL_IPC.SESSION_ATTACH,
        options.engagementId,
        options.shellSessionId,
        options.ownerId,
      );
      return { sessionId: session.id, title: session.title, managedShell: true };
    }
    return window.hexestra.invoke<TerminalSessionLease>(
      'terminal:create',
      options?.engagementId,
      activeTargetIdRef.current,
      options?.ownerId,
    );
  }, [options?.disabled, options?.engagementId, options?.ownerId, options?.shellSessionId]);

  const write = useCallback((data: string) => {
    if (sessionIdRef.current && window.hexestra) {
      void window.hexestra.invoke(
        options?.shellSessionId ? SHELL_IPC.SESSION_WRITE : 'terminal:write',
        ...(options?.shellSessionId
          ? [options.engagementId, sessionIdRef.current, data]
          : [sessionIdRef.current, data]),
      );
    }
  }, [options?.engagementId, options?.shellSessionId]);

  const resize = useCallback((cols: number, rows: number) => {
    if (sessionIdRef.current && window.hexestra) {
      void window.hexestra.invoke(
        options?.shellSessionId ? SHELL_IPC.SESSION_RESIZE : 'terminal:resize',
        ...(options?.shellSessionId
          ? [options.engagementId, sessionIdRef.current, cols, rows]
          : [sessionIdRef.current, cols, rows]),
      );
    }
  }, [options?.engagementId, options?.shellSessionId]);

  const closeSession = useCallback((lease = sessionLeaseRef.current) => {
    if (lease && window.hexestra) {
      if (!lease.managedShell) {
        void window.hexestra.invoke('terminal:close', lease.sessionId, lease.leaseId);
      }
      if (sessionLeaseRef.current?.leaseId === lease.leaseId) {
        sessionLeaseRef.current = null;
        sessionIdRef.current = null;
      }
    }
  }, []);

  const copySelection = useCallback(async () => {
    const terminal = termRef.current;
    const selection = terminal?.getSelection() ?? '';
    if (!selection || !window.hexestra) return false;
    await window.hexestra.invoke('clipboard:write-text', selection);
    terminal?.focus();
    return true;
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    const terminal = termRef.current;
    if (!terminal || !window.hexestra) return false;
    const text = await window.hexestra.invoke<string>('clipboard:read-text');
    if (!text) return false;
    terminal.focus();
    terminal.paste(text);
    return true;
  }, []);

  const selectAll = useCallback(() => {
    const terminal = termRef.current;
    if (!terminal) return false;
    terminal.selectAll();
    terminal.focus();
    return true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !window.hexestra || options?.disabled) return;

    let disposed = false;
    let resizeFrame: number | null = null;
    let lastWidth = -1;
    let lastHeight = -1;
    let lastCols = 0;
    let lastRows = 0;
    let followOutput = true;
    let pendingOutput = '';
    let outputTimer: number | null = null;
    let pendingShouldFollow = true;
    let inputDisposable: { dispose: () => void } | null = null;
    let scrollDisposable: { dispose: () => void } | null = null;
    let selectionDisposable: { dispose: () => void } | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: getMonoFontFamily(),
      fontSize: APP_CODE_FONT_SIZE_PX,
      lineHeight: 1.4,
      theme: getTerminalTheme(resolvedThemeRef.current),
      allowProposedApi: true,
      scrollOnUserInput: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);

    const emitScrollState = () => {
      const buffer = terminal.buffer.active;
      const isAtBottom = buffer.viewportY >= buffer.baseY;
      followOutput = isAtBottom;
      onScrollChangeRef.current?.({
        viewportY: buffer.viewportY,
        baseY: buffer.baseY,
        isAtBottom,
      });
    };

    // Chromium can treat xterm's internal wheel listener as passive in some
    // Electron builds. Own normal-buffer wheel scrolling at the container
    // boundary so the history viewport remains usable and deterministic.
    const handleWheel = (event: WheelEvent) => {
      const buffer = terminal.buffer.active;
      if (buffer.type !== 'normal' || buffer.baseY === 0 || event.deltaY === 0) return;

      const direction = Math.sign(event.deltaY);
      const canScroll = direction < 0 ? buffer.viewportY > 0 : buffer.viewportY < buffer.baseY;
      if (!canScroll) return;

      const lineHeight = (terminal.options.fontSize ?? APP_CODE_FONT_SIZE_PX) * (terminal.options.lineHeight ?? 1);
      const rawLines =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.abs(event.deltaY) * terminal.rows
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? Math.abs(event.deltaY)
            : Math.abs(event.deltaY) / lineHeight;
      const lines = Math.min(Math.max(1, Math.round(rawLines)), terminal.rows * 3);

      event.preventDefault();
      event.stopPropagation();
      terminal.scrollLines(direction * lines);
    };
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    terminal.attachCustomKeyEventHandler((event) => {
      const clipboardAction = terminalClipboardAction(event);
      if (clipboardAction === 'copy') {
        void copySelection();
        return false;
      }
      if (clipboardAction === 'native-paste') {
        // xterm's native paste event owns keyboard paste. Context-menu paste
        // still uses the bounded Electron clipboard IPC path.
        return false;
      }
      if (event.type !== 'keydown') return true;
      if (event.key === 'PageUp') {
        terminal.scrollPages(-1);
        return false;
      }
      if (event.key === 'PageDown') {
        terminal.scrollPages(1);
        return false;
      }
      if (event.key === 'Home' && event.ctrlKey) {
        terminal.scrollToTop();
        return false;
      }
      if (event.key === 'End' && event.ctrlKey) {
        terminal.scrollToBottom();
        return false;
      }
      return true;
    });
    scrollDisposable = terminal.onScroll(emitScrollState);
    selectionDisposable = terminal.onSelectionChange(() => {
      onSelectionChangeRef.current?.(terminal.hasSelection());
    });

    const fitTerminal = () => {
      resizeFrame = null;
      if (disposed) return;
      fitAddon.fit();
      if (
        terminal.cols > 0 &&
        terminal.rows > 0 &&
        (terminal.cols !== lastCols || terminal.rows !== lastRows)
      ) {
        lastCols = terminal.cols;
        lastRows = terminal.rows;
        resize(terminal.cols, terminal.rows);
      }
    };

    const scheduleFit = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitTerminal);
    };

    void createSession().then((lease) => {
      if (!lease) return;
      if (disposed) {
        closeSession(lease);
        return;
      }
      sessionLeaseRef.current = lease;
      sessionIdRef.current = lease.sessionId;
      if (!lease.managedShell) {
        void window.hexestra?.invoke('terminal:set-context', lease.sessionId, activeTargetIdRef.current);
      } else if (options?.engagementId) {
        void window.hexestra.invoke<{ content: string }>(
          SHELL_IPC.SESSION_READ,
          options.engagementId,
          lease.sessionId,
          2_000,
          262_144,
        ).then((snapshot) => {
          if (!disposed && snapshot.content) terminal.write(snapshot.content);
        });
      }
      inputDisposable = terminal.onData(write);
      scheduleFit();
    }).catch((error: unknown) => {
      if (!disposed) terminal.writeln(`\r\n\x1b[31m[Unable to attach shell: ${error instanceof Error ? error.message : String(error)}]\x1b[0m`);
    });

    const unsubscribeOutput = window.hexestra.on('terminal:output', (data: unknown) => {
      if (options?.shellSessionId) return;
      const payload = data as { sessionId: string; data: string };
      if (payload.sessionId === sessionIdRef.current) {
        pendingOutput += payload.data;
        if (outputTimer === null) {
          // Coalesce bursty ConPTY chunks into one xterm write. This prevents
          // hundreds of queued writes from leaving the DOM scrollbar behind
          // the already-complete PTY stream.
          pendingShouldFollow = followOutput;
          outputTimer = window.setTimeout(() => {
            outputTimer = null;
            const output = pendingOutput;
            pendingOutput = '';
            terminal.write(output, () => {
              if (pendingShouldFollow) terminal.scrollToBottom();
              emitScrollState();
            });
          }, 0);
        }
        onOutputRef.current?.(payload.data);
      }
    });

    const unsubscribeShellOutput = window.hexestra.on(SHELL_IPC.OUTPUT, (data: unknown) => {
      if (!options?.shellSessionId) return;
      const payload = data as { projectId: string; sessionId: string; data: string };
      if (payload.projectId !== options.engagementId || payload.sessionId !== sessionIdRef.current) return;
      pendingOutput += payload.data;
      if (outputTimer === null) {
        pendingShouldFollow = followOutput;
        outputTimer = window.setTimeout(() => {
          outputTimer = null;
          const output = pendingOutput;
          pendingOutput = '';
          terminal.write(output, () => {
            if (pendingShouldFollow) terminal.scrollToBottom();
            emitScrollState();
          });
        }, 0);
      }
      onOutputRef.current?.(payload.data);
    });

    const unsubscribeExit = window.hexestra.on('terminal:exit', (data: unknown) => {
      const payload = data as { sessionId: string; exitCode: number };
      if (payload.sessionId !== sessionIdRef.current || disposed) return;

      sessionIdRef.current = null;
      sessionLeaseRef.current = null;
      terminal.writeln(`\r\n\x1b[90m[Process exited with code ${payload.exitCode}]\x1b[0m`);
      void createSession().then((lease) => {
        if (!lease) return;
        if (disposed) {
          closeSession(lease);
          return;
        }
        sessionLeaseRef.current = lease;
        sessionIdRef.current = lease.sessionId;
        void window.hexestra?.invoke('terminal:set-context', lease.sessionId, activeTargetIdRef.current);
        scheduleFit();
      });
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      scheduleFit();
    });
    resizeObserver.observe(container);

    termRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();

    return () => {
      disposed = true;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (outputTimer !== null) window.clearTimeout(outputTimer);
      resizeObserver.disconnect();
      container.removeEventListener('wheel', handleWheel, true);
      inputDisposable?.dispose();
      scrollDisposable?.dispose();
      selectionDisposable?.dispose();
      unsubscribeOutput();
      unsubscribeShellOutput();
      unsubscribeExit();
      closeSession();
      terminal.dispose();
    };
  }, [closeSession, containerRef, copySelection, createSession, options?.disabled, pasteFromClipboard, resize, write]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = getTerminalTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !window.hexestra) return;
    if (!options?.shellSessionId) {
      void window.hexestra.invoke('terminal:set-context', sessionId, options?.activeTargetId);
    }
  }, [options?.activeTargetId, options?.shellSessionId]);

  return {
    term: termRef,
    fitAddon: fitAddonRef,
    sessionId: sessionIdRef,
    write,
    resize,
    closeSession,
    scrollPages: (pages: number) => termRef.current?.scrollPages(pages),
    scrollToTop: () => termRef.current?.scrollToTop(),
    scrollToBottom: () => termRef.current?.scrollToBottom(),
    clear: () => termRef.current?.clear(),
    hasSelection: () => termRef.current?.hasSelection() ?? false,
    copySelection,
    pasteFromClipboard,
    selectAll,
    takeover: () => options?.shellSessionId && options.engagementId
      ? window.hexestra.invoke(SHELL_IPC.SESSION_TAKEOVER, options.engagementId, options.shellSessionId)
      : Promise.resolve(false),
    disconnect: () => options?.shellSessionId && options.engagementId
      ? window.hexestra.invoke(SHELL_IPC.SESSION_DISCONNECT, options.engagementId, options.shellSessionId)
      : Promise.resolve(false),
  };
}
