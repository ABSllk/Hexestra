import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentConnectionSettings, AgentSettingsContainer } from '@electron/contracts/agent-settings';
import type { ClaudeSkillListResult } from '@electron/contracts/claude-capabilities';
import {
  normalizeAgentCommandsChangedPayload,
  normalizeAgentSlashCommand,
  normalizeAgentSlashCommands,
  type AgentSlashCommandDescriptor,
} from '@electron/agent-command-contract';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { agentContextRefKey, type AgentAttachment, type AgentAttachmentPicker, type AgentContextRef, type AutonomyLevel } from '@/types';
import { ClaudeModeSelector } from './ClaudeModeSelector';
import { useI18n } from '@/i18n';

type ComposerMenu = 'attachments' | 'mode' | 'model' | 'autonomy' | null;

interface ComposerCommand {
  name: string;
  description: string;
  argumentHint: string;
  source: 'runtime' | 'builtin' | 'skill' | 'app';
}

export function ChatInput() {
  const { t } = useI18n();
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [connectionSettings, setConnectionSettings] = useState<AgentSettingsContainer | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [runtimeCommands, setRuntimeCommands] = useState<ComposerCommand[] | null>(null);
  const [skillCommands, setSkillCommands] = useState<ComposerCommand[]>([]);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [dismissedCommandQuery, setDismissedCommandQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const text = useChatStore((state) => state.composerText);
  const setText = useChatStore((state) => state.setComposerText);
  const contextRefs = useChatStore((state) => state.composerContextRefs) ?? [];
  const focusNonce = useChatStore((state) => state.composerFocusNonce);
  const removeComposerContext = useChatStore((state) => state.removeComposerContext);
  const isProcessing = useChatStore((state) => state.isProcessing);
  const cancelRequest = useChatStore((state) => state.cancelRequest);
  const permissionMode = useChatStore((state) => state.permissionMode);
  const setPermissionMode = useChatStore((state) => state.setPermissionMode);
  const autonomyLevel = useChatStore((state) => state.autonomyLevel);
  const setAutonomyLevel = useChatStore((state) => state.setAutonomyLevel);
  const agentStatus = useChatStore((state) => state.agentStatus);
  const refreshStatus = useChatStore((state) => state.refreshStatus);
  const activeProjectId = useChatStore((state) => state.activeProjectId);

  const commands = commandCatalog(t, runtimeCommands, skillCommands);
  const activeCommand = commandForText(text, commands);
  const commandQuery = activeCommand ? null : slashCommandQuery(text);
  const commandSuggestions = commandQuery === null
    ? []
    : commands.filter((command) => command.name.slice(1).toLowerCase().startsWith(commandQuery.toLowerCase()));
  const showCommandSuggestions = commandSuggestions.length > 0
    && dismissedCommandQuery !== commandQuery;
  const visibleText = activeCommand ? commandArguments(text, activeCommand.name) : text;

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<AgentSettingsContainer>('agent:settings:get')
      .then((raw) => {
        if (!active) return;
        const settings = normalizeSettingsPayload(raw);
        setConnectionSettings(settings);
        setModelDraft(settings.backends.claude.model ?? '');
      })
      .catch((error) => active && setComposerError(String(error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    let receivedLiveUpdate = false;
    setRuntimeCommands(null);
    const unsubscribe = window.hexestra.on('agent:commands-changed', (value: unknown) => {
      const payload = normalizeAgentCommandsChangedPayload(value);
      if (!active || !payload || payload.sessionId !== (activeProjectId ?? null)) return;
      receivedLiveUpdate = true;
      const commands = expandRuntimeCommands(payload.commands);
      setRuntimeCommands(commands.length > 0 ? commands : null);
    });
    void window.hexestra.invoke<unknown>('agent:commands:list', activeProjectId)
      .then((value) => {
        if (!active || receivedLiveUpdate) return;
        const commands = expandRuntimeCommands(normalizeAgentSlashCommands(value));
        setRuntimeCommands(commands.length > 0 ? commands : null);
      })
      .catch(() => active && !receivedLiveUpdate && setRuntimeCommands(null));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [activeProjectId, agentStatus.runtimeLabel, agentStatus.runtimeMode]);

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<ClaudeSkillListResult>('claude:skills:list', activeProjectId)
      .then((result) => {
        if (!active) return;
        setSkillCommands(result.items
          .filter((item) => item.enabled)
          .map((item) => ({
            name: `/${item.name}`,
            description: item.description,
            argumentHint: '',
            source: 'skill' as const,
          })));
      })
      .catch(() => active && setSkillCommands([]));
    return () => { active = false; };
  }, [activeProjectId]);

  useEffect(() => {
    setActiveCommandIndex(0);
    setDismissedCommandQuery(null);
  }, [commandQuery]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [openMenu]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    adjustHeight();
  }, [text]);

  const handleSend = useCallback(async () => {
    if ((!text.trim() && attachments.length === 0 && contextRefs.length === 0) || isProcessing) return;
    const content = text.trim() || 'Analyze the attached material in the context of this penetration-testing project.';
    if (normalizeAgentSlashCommand(content) && (attachments.length > 0 || contextRefs.length > 0)) {
      setComposerError(t('agent.commandContextError'));
      return;
    }
    const outgoingAttachments = attachments;
    setAttachments([]);
    setOpenMenu(null);
    setComposerError(null);
    try {
      await sendMessage(content, outgoingAttachments);
    } catch {
      // The store owns request errors; preserve only composer-specific errors here.
    }
    textareaRef.current?.focus();
  }, [attachments, contextRefs.length, isProcessing, sendMessage, text]);

  const pickAttachments = async (picker: AgentAttachmentPicker) => {
    if (!window.hexestra) return;
    setOpenMenu(null);
    setComposerError(null);
    try {
      const selected = await window.hexestra.invoke<AgentAttachment[]>('agent:attachments:pick', picker);
      setAttachments((current) => {
        const byPath = new Map(current.map((attachment) => [attachment.path, attachment]));
        for (const attachment of selected) byPath.set(attachment.path, attachment);
        return [...byPath.values()].slice(0, 8);
      });
    } catch (error) {
      setComposerError(String(error));
    }
  };

  const saveModel = async (model: string | null) => {
    if (!window.hexestra || !connectionSettings || isProcessing) return;
    setComposerError(null);
    try {
      const raw = await window.hexestra.invoke<AgentSettingsContainer | AgentConnectionSettings>('agent:settings:update', {
        ...connectionSettings,
        backends: {
          ...connectionSettings.backends,
          claude: { ...connectionSettings.backends.claude, model },
        },
      });
      const updated = normalizeSettingsPayload(raw);
      setConnectionSettings(updated);
      setModelDraft(updated.backends.claude.model ?? '');
      setOpenMenu(null);
      await refreshStatus();
    } catch (error) {
      setComposerError(String(error));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (showCommandSuggestions) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveCommandIndex((current) => (current + 1) % commandSuggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveCommandIndex((current) => (current - 1 + commandSuggestions.length) % commandSuggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        chooseCommand(commandSuggestions[activeCommandIndex] ?? commandSuggestions[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedCommandQuery(commandQuery);
        return;
      }
    }
    if (activeCommand && event.key === 'Backspace' && !visibleText) {
      event.preventDefault();
      setText(activeCommand.name.slice(0, -1));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const chooseCommand = (command: ComposerCommand) => {
    setText(replaceSlashCommandToken(text, command.name));
    setDismissedCommandQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const adjustHeight = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  };

  const modeLabel = permissionMode === 'default' ? 'ASK' : permissionMode === 'auto' ? 'AUTO' : 'BYPASS';
  const modelLabel = connectionSettings?.backends?.claude?.model ?? agentStatus.model ?? 'Default';

  return (
    <div ref={composerRef} className="relative z-30 shrink-0 border-t border-border-subtle bg-canvas/95 p-3">
      <div className="rounded-xl border border-border-subtle/80 bg-panel shadow-lg shadow-black/10 transition-colors focus-within:!border-accent-blue/45 hover:border-border-strong/60">
        {contextRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {contextRefs.map((ref) => (
              <span key={agentContextRefKey(ref)} title={agentContextTitle(ref)} className="flex max-w-full items-center gap-1.5 rounded-md border border-accent-blue/20 bg-accent-blue/8 px-2 py-1 text-[11px] text-text-secondary">
                <Icon name={ref.kind === 'browser-page' ? 'browser' : 'activity'} size={11} className="text-accent-blue" />
                <span className="max-w-44 truncate">{agentContextLabel(ref)}</span>
                <button
                  aria-label={`Remove ${agentContextLabel(ref)}`}
                  onClick={() => removeComposerContext(agentContextRefKey(ref))}
                  className="rounded text-text-muted hover:text-text-primary"
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-panel/70 px-2 py-1 text-[11px] text-text-secondary">
                <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={11} className="text-accent-teal" />
                <span className="max-w-36 truncate">{attachment.name}</span>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  className="rounded text-text-muted hover:text-text-primary"
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex min-h-16 min-w-0 items-start gap-2 px-3 pb-2 pt-3">
          {activeCommand && (
            <button
              type="button"
              aria-label={`${t('agent.editCommand')} ${activeCommand.name}`}
              title={t('agent.editCommand')}
              onClick={() => {
                setText(activeCommand.name.slice(0, -1));
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              className="mt-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md border border-accent-blue/30 bg-accent-blue/10 px-2 font-mono text-[11px] font-semibold text-accent-blue transition-colors hover:border-accent-blue/50 hover:bg-accent-blue/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue"
            >
              <Icon name="terminal" size={11} />
              {activeCommand.name}
              <Icon name="close" size={9} className="opacity-60" />
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={visibleText}
            onChange={(event) => {
              setText(activeCommand
                ? `${activeCommand.name}${event.target.value ? ` ${event.target.value}` : ''}`
                : event.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder={activeCommand ? t('agent.commandArguments') : t('agent.placeholder')}
            rows={2}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showCommandSuggestions}
            aria-controls={showCommandSuggestions ? 'agent-command-suggestions' : undefined}
            aria-activedescendant={showCommandSuggestions ? `agent-command-option-${activeCommandIndex}` : undefined}
            className="max-h-36 min-h-10 min-w-0 flex-1 resize-none rounded-xl border-0 bg-transparent p-0 font-sans text-xs leading-5 text-text-primary placeholder:text-text-muted focus-visible:outline-none"
            disabled={isProcessing}
          />
        </div>

        {composerError && <div className="px-4 pb-1 text-[11px] text-severity-critical">{composerError}</div>}

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-1 select-none">
            <ComposerTrigger active={openMenu === 'attachments'} ariaLabel={t('agent.addFilesImages')} onClick={() => setOpenMenu((current) => current === 'attachments' ? null : 'attachments')} icon="plus" />
            <ComposerTrigger active={openMenu === 'mode'} ariaLabel={`Claude mode ${modeLabel}`} onClick={() => setOpenMenu((current) => current === 'mode' ? null : 'mode')} icon="shield" label={modeLabel} danger={permissionMode === 'bypassPermissions'} />
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1 select-none">
            <ComposerTrigger active={openMenu === 'model'} ariaLabel={`Model ${modelLabel}`} onClick={() => setOpenMenu((current) => current === 'model' ? null : 'model')} icon="bot" label="MODEL" />
            <ComposerTrigger active={openMenu === 'autonomy'} ariaLabel={`Autonomy ${autonomyLevel}`} onClick={() => setOpenMenu((current) => current === 'autonomy' ? null : 'autonomy')} icon="sparkles" label={autonomyLevel.toUpperCase()} />
            <button
              aria-label={isProcessing ? t('agent.cancelRequest') : t('agent.send')}
              onClick={() => isProcessing ? void cancelRequest() : void handleSend()}
              disabled={!isProcessing && !text.trim() && attachments.length === 0 && contextRefs.length === 0}
              className={cn('ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors', isProcessing ? 'bg-severity-medium/15 text-severity-medium hover:bg-severity-medium/25' : 'bg-text-primary text-canvas hover:bg-accent-blue disabled:cursor-not-allowed disabled:bg-raised disabled:text-text-muted')}
            >
              <Icon name={isProcessing ? 'close' : 'send'} size={14} />
            </button>
          </div>
        </div>
      </div>

      {showCommandSuggestions && (
        <div
          id="agent-command-suggestions"
          role="listbox"
          aria-label={t('agent.commandSuggestions')}
          className="ui-popover absolute bottom-full left-3 right-3 z-30 mb-2 max-h-56 overflow-y-auto p-1.5"
        >
          {commandSuggestions.map((command, index) => (
            <button
              key={command.name}
              id={`agent-command-option-${index}`}
              role="option"
              aria-selected={index === activeCommandIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(command)}
              className={cn(
                'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                index === activeCommandIndex ? 'bg-accent-blue/10 text-text-primary' : 'text-text-secondary hover:bg-raised/60',
              )}
            >
              <span className="shrink-0 rounded border border-accent-blue/25 bg-accent-blue/8 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent-blue">{command.name}</span>
              {command.argumentHint && <span className="shrink-0 font-mono text-[10px] text-text-muted">{command.argumentHint}</span>}
              <span className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-4 text-text-muted">{command.description}</span>
              {command.source === 'skill' && <span className="shrink-0 text-[10px] uppercase tracking-wide text-accent-teal">Skill</span>}
            </button>
          ))}
        </div>
      )}

      {openMenu === 'attachments' && <Popover align="left" label={t('agent.addContext')}>
        <MenuButton icon="file" label={t('agent.addFiles')} detail="Text, code, PDF, or a local path" onClick={() => void pickAttachments('files')} />
        <MenuButton icon="image" label={t('agent.addImages')} detail="PNG, JPEG, GIF, or WebP" onClick={() => void pickAttachments('images')} />
        <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] leading-4 text-text-muted">Up to 8 attachments · 10 MB each</p>
      </Popover>}

      {openMenu === 'mode' && <Popover align="left" label="Claude Mode" wide>
        <ClaudeModeSelector value={permissionMode} onChange={(mode) => { setPermissionMode(mode); setOpenMenu(null); }} isProcessing={isProcessing} />
      </Popover>}

      {openMenu === 'model' && <Popover align="right" label={t('agent.model')} wide>
        <p className="mb-2 text-[11px] leading-4 text-text-muted">{t('agent.modelHint')}</p>
        <input aria-label={t('agent.modelId')} value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} placeholder={agentStatus.model ?? 'Default'} className="h-8 w-full rounded border border-border-subtle bg-panel px-2 font-mono text-[11px] text-text-primary outline-none focus:border-accent-blue/50" />
        <div className="mt-2 flex justify-between gap-2">
          <button disabled={isProcessing} onClick={() => void saveModel(null)} className="rounded px-2 py-1 text-[11px] text-text-muted hover:bg-raised hover:text-text-primary disabled:opacity-40">{t('agent.useDefault')}</button>
          <button disabled={isProcessing} onClick={() => void saveModel(modelDraft.trim() || null)} className="rounded bg-accent-blue/15 px-2 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/25 disabled:opacity-40">{t('agent.applyModel')}</button>
        </div>
      </Popover>}

      {openMenu === 'autonomy' && <Popover align="right" label={t('agent.autonomy')}>
        {(['low', 'medium', 'high'] as AutonomyLevel[]).map((level) => (
          <button key={level} aria-pressed={autonomyLevel === level} onClick={() => { setAutonomyLevel(level); setOpenMenu(null); }} className={cn('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] uppercase', autonomyLevel === level ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-raised/50')}>
            {level}{autonomyLevel === level && <Icon name="check" size={11} />}
          </button>
        ))}
      </Popover>}
    </div>
  );
}

function normalizeSettingsPayload(value: AgentSettingsContainer | AgentConnectionSettings): AgentSettingsContainer {
  if ('backends' in value) return value;
  return {
    version: 2,
    defaultBackendId: 'claude',
    backends: { claude: value },
  };
}

function agentContextLabel(ref: AgentContextRef) {
  if (ref.kind === 'browser-page') {
    if (ref.selectionText) return `Selection: ${ref.selectionText.slice(0, 42)}`;
    if (ref.linkUrl) return `Link: ${ref.linkUrl}`;
    return ref.title || ref.url;
  }
  if (ref.kind === 'shell-command') return `${ref.templateLabel}: ${ref.callbackAddress}:${ref.callbackPort}`;
  return `${ref.method} ${ref.host || ref.url}`;
}

function agentContextTitle(ref: AgentContextRef) {
  if (ref.kind === 'browser-page') return ref.linkUrl || ref.url;
  if (ref.kind === 'shell-command') return `${ref.templateLabel}\n${ref.callbackAddress}:${ref.callbackPort}`;
  return `${ref.method} ${ref.url}\nFlow ${ref.flowId}`;
}

function ComposerTrigger({ active, ariaLabel, onClick, icon, label, danger = false }: { active: boolean; ariaLabel: string; onClick: () => void; icon: 'plus' | 'shield' | 'bot' | 'sparkles'; label?: string; danger?: boolean }) {
  return <button aria-label={ariaLabel} aria-expanded={active} onClick={onClick} className={cn('flex h-7 min-w-7 max-w-full items-center justify-center gap-1 overflow-hidden rounded-lg px-1.5 text-[11px] font-medium transition-colors', danger ? 'text-severity-critical hover:bg-severity-critical/10' : active ? 'bg-raised text-text-primary' : 'text-text-muted hover:bg-raised/60 hover:text-text-secondary')}>
    <Icon name={icon} size={13} />
    {label && <span className="min-w-0 truncate">{label}</span>}
    {label && <Icon name="chevron-right" size={9} className="rotate-90 opacity-60" />}
  </button>;
}

function Popover({ align, label, wide = false, children }: { align: 'left' | 'right'; label: string; wide?: boolean; children: React.ReactNode }) {
  return <div aria-label={label} className={cn('ui-popover absolute bottom-[3.25rem] z-20 max-h-64 overflow-y-auto p-2', align === 'left' ? 'left-3' : 'right-3', wide ? 'w-72 max-w-[calc(100%-1.5rem)]' : 'w-56 max-w-[calc(100%-1.5rem)]')}>{children}</div>;
}

function MenuButton({ icon, label, detail, onClick }: { icon: 'file' | 'image'; label: string; detail: string; onClick: () => void }) {
  return <button aria-label={label} onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-raised/45">
    <Icon name={icon} size={14} className="mt-0.5 text-accent-teal" />
    <span><span className="block text-[11px] font-medium text-text-primary">{label}</span><span className="mt-0.5 block text-[11px] text-text-muted">{detail}</span></span>
  </button>;
}

function commandCatalog(
  t: ReturnType<typeof useI18n>['t'],
  runtimeCommands: ComposerCommand[] | null,
  skillCommands: ComposerCommand[],
): ComposerCommand[] {
  const builtins: ComposerCommand[] = [
    { name: '/distill', description: t('agent.commandDistill'), argumentHint: '', source: 'app' },
    { name: '/compact', description: t('agent.commandCompact'), argumentHint: '', source: 'builtin' },
    { name: '/context', description: t('agent.commandContext'), argumentHint: '', source: 'builtin' },
    { name: '/cost', description: t('agent.commandCost'), argumentHint: '', source: 'builtin' },
    { name: '/help', description: t('agent.commandHelp'), argumentHint: '', source: 'builtin' },
    { name: '/status', description: t('agent.commandStatus'), argumentHint: '', source: 'builtin' },
  ];
  const byName = new Map(builtins.map((command) => [command.name, command]));
  // Runtime entries retain their richer argument hints, while application
  // commands such as /distill remain visible when the runtime omits them.
  for (const command of runtimeCommands ?? []) if (command.name !== '/distill') byName.set(command.name, command);
  for (const command of skillCommands) if (!byName.has(command.name)) byName.set(command.name, command);
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function expandRuntimeCommands(commands: AgentSlashCommandDescriptor[]): ComposerCommand[] {
  const expanded = new Map<string, ComposerCommand>();
  for (const command of commands) {
    expanded.set(command.name, {
      name: command.name,
      description: command.description,
      argumentHint: command.argumentHint,
      source: 'runtime',
    });
    for (const alias of command.aliases) {
      if (expanded.has(alias)) continue;
      expanded.set(alias, {
        name: alias,
        description: command.description,
        argumentHint: command.argumentHint,
        source: 'runtime',
      });
    }
  }
  return [...expanded.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function slashCommandQuery(content: string) {
  const match = content.match(/^\/([^\s]*)$/);
  return match ? match[1] : null;
}

function commandForText(content: string, commands: ComposerCommand[]) {
  const trimmed = content.trimStart();
  return commands.find((command) => trimmed === command.name || trimmed.startsWith(`${command.name} `)) ?? null;
}

function commandArguments(content: string, commandName: string) {
  return content.trimStart().slice(commandName.length).replace(/^\s+/, '');
}

function replaceSlashCommandToken(content: string, commandName: string) {
  const remainder = content.trimStart().replace(/^\/[^\s]*/, '').replace(/^\s+/, '');
  return `${commandName}${remainder ? ` ${remainder}` : ''}`;
}
