import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentConnectionSettings, AgentSettingsContainer } from '@electron/contracts/agent-settings';
import type { AgentReasoningEffort } from '@electron/contracts/agent-runtime';
import type { ClaudeSkillListResult } from '@electron/contracts/claude-capabilities';
import {
  normalizeAgentCommandsChangedPayload,
  normalizeAgentSlashCommand,
  normalizeAgentSlashCommands,
  type AgentSkillDescriptor,
  type AgentSlashCommandDescriptor,
} from '@electron/agent-command-contract';
import { Icon, ReasoningEffortSlider } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { openSettingsTab } from '@/stores/useTabStore';
import { agentContextRefKey, type AgentAttachment, type AgentAttachmentPicker, type AgentContextRef, type AutonomyLevel } from '@/types';
import { ClaudeModeSelector } from './ClaudeModeSelector';
import { useI18n } from '@/i18n';
import { useAgentModels } from '@/hooks/useAgentModels';

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
  const [composerError, setComposerError] = useState<string | null>(null);
  const [runtimeCommands, setRuntimeCommands] = useState<ComposerCommand[] | null>(null);
  const [skillCommands, setSkillCommands] = useState<ComposerCommand[]>([]);
  const [codexSkillCommands, setCodexSkillCommands] = useState<ComposerCommand[]>([]);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [dismissedCommandQuery, setDismissedCommandQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const newConversation = useChatStore((state) => state.newConversation);
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

  const isCodex = agentStatus.backendId === 'codex';
  const modelBackendId = isCodex ? 'codex' : 'claude';
  const modelCatalog = useAgentModels(modelBackendId, openMenu === 'model', activeProjectId);
  const commands = isCodex
    ? codexCommandCatalog(t, codexSkillCommands)
    : commandCatalog(t, runtimeCommands, skillCommands);
  const activeCommand = commandForText(text, commands);
  const commandQuery = activeCommand ? null : completionQuery(text);
  const commandSuggestions = commandQuery === null
    ? []
    : commands.filter((command) => command.name.toLowerCase().startsWith(commandQuery.toLowerCase()));
  const showCommandSuggestions = commandSuggestions.length > 0
    && dismissedCommandQuery !== commandQuery;
  const visibleText = activeCommand ? commandArguments(text, activeCommand.name) : text;
  const isCodexSkillQuery = isCodex && text.trimStart().startsWith('/');

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<AgentSettingsContainer>('agent:settings:get')
      .then((raw) => {
        if (!active) return;
        const settings = normalizeSettingsPayload(raw);
        setConnectionSettings(settings);
      })
      .catch((error) => active && setComposerError(String(error)));
    return () => { active = false; };
  }, [agentStatus.backendId]);

  useEffect(() => {
    if (openMenu !== 'model' || !window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<AgentSettingsContainer>('agent:settings:get')
      .then((value) => active && setConnectionSettings(normalizeSettingsPayload(value)))
      .catch((reason) => active && setComposerError(String(reason)));
    return () => { active = false; };
  }, [openMenu]);

  useEffect(() => {
    if (!window.hexestra || isCodex) { setRuntimeCommands(null); return; }
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
  }, [activeProjectId, agentStatus.runtimeLabel, agentStatus.runtimeMode, isCodex]);

  useEffect(() => {
    if (!window.hexestra || isCodex) { setSkillCommands([]); return; }
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
  }, [activeProjectId, isCodex]);

  useEffect(() => {
    if (!window.hexestra || !isCodexSkillQuery) { setCodexSkillCommands([]); return; }
    let active = true;
    let revision = 0;
    setCodexSkillCommands([]);
    const refresh = () => {
      const request = ++revision;
      void window.hexestra.invoke<AgentSkillDescriptor[]>('codex:skills:list', activeProjectId)
        .then((skills) => {
          if (!active || request !== revision) return;
          setCodexSkillCommands(skills.map((skill) => ({
            name: `/${skill.name}`,
            description: skill.description,
            argumentHint: '',
            source: 'skill' as const,
          })));
        })
        .catch(() => active && request === revision && setCodexSkillCommands([]));
    };
    const unsubscribe = window.hexestra.on('codex:skills-changed', refresh);
    refresh();
    return () => { active = false; unsubscribe(); };
  }, [activeProjectId, isCodexSkillQuery]);

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

  useLayoutEffect(() => {
    const element = textareaRef.current;
    const composer = composerRef.current;
    if (!element || !composer) return;
    const resize = () => {
      element.style.height = '32px';
      if (element.value) element.style.height = `${Math.max(32, Math.min(element.scrollHeight, 144))}px`;
    };
    resize();
    let width = composer.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, [text]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && attachments.length === 0 && contextRefs.length === 0) return;
    const content = text.trim() || 'Analyze the attached material in the context of this penetration-testing project.';
    if (isCodex) {
      if (content === '/model' || content === '/permissions' || content === '/mcp' || content === '/new') {
        setComposerError(null);
        if (content === '/model') { setText(''); setOpenMenu('model'); }
        if (content === '/permissions') { setText(''); setOpenMenu('mode'); }
        if (content === '/mcp') { setText(''); setOpenMenu(null); openSettingsTab('connection'); }
        if (content === '/new' && await newConversation('codex')) { setAttachments([]); setOpenMenu(null); }
        textareaRef.current?.focus();
        return;
      }
    }
    if (!isCodex && normalizeAgentSlashCommand(content) && (attachments.length > 0 || contextRefs.length > 0)) {
      setComposerError(t('agent.commandContextError'));
      return;
    }
    const outgoingAttachments = attachments;
    setAttachments([]);
    setOpenMenu(null);
    setComposerError(null);
    try {
      const outgoingContent = isCodex && activeCommand?.source === 'skill'
        ? `$${content.slice(1)}` : content;
      await sendMessage(outgoingContent, outgoingAttachments);
    } catch {
      // The store owns request errors; preserve only composer-specific errors here.
    }
    textareaRef.current?.focus();
  }, [activeCommand, attachments, contextRefs.length, isCodex, newConversation, sendMessage, text]);

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

  const saveModelSettings = async (model: string | null, reasoningEffort: AgentReasoningEffort | null, closeMenu = true): Promise<boolean> => {
    if (!window.hexestra || !connectionSettings || isProcessing) return false;
    setComposerError(null);
    try {
      const raw = await window.hexestra.invoke<AgentSettingsContainer | AgentConnectionSettings>('agent:settings:update', {
        ...connectionSettings,
        backends: {
          ...connectionSettings.backends,
          [modelBackendId]: { ...connectionSettings.backends[modelBackendId], model, reasoningEffort },
        },
      });
      const updated = normalizeSettingsPayload(raw);
      setConnectionSettings(updated);
      if (closeMenu) setOpenMenu(null);
      await refreshStatus();
      return true;
    } catch (error) {
      setComposerError(String(error));
      return false;
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
    setText(replaceCommandToken(text, command.name));
    setDismissedCommandQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const modeLabel = t(`agent.permissionMode.${permissionMode}`);
  const modeShortLabel = permissionMode === 'bypassPermissions'
    ? t('agent.permissionModeShort.bypassPermissions') : modeLabel;
  const modelLabel = connectionSettings?.backends?.[isCodex ? 'codex' : 'claude']?.model ?? agentStatus.model ?? 'Default';
  const selectedModel = connectionSettings?.backends[modelBackendId].model ?? null;
  const selectedModelOption = modelCatalog.models.find((model) => model.id === selectedModel || model.resolvedModel === selectedModel);
  const effectiveModelOption = selectedModelOption ?? (!selectedModel
    ? modelCatalog.models.find((model) => model.id === agentStatus.model || model.resolvedModel === agentStatus.model)
      ?? modelCatalog.models.find((model) => model.isDefault || model.id === 'default')
      ?? modelCatalog.models[0]
    : undefined);
  const selectedEffort = connectionSettings?.backends[modelBackendId].reasoningEffort ?? null;
  const availableEfforts = effectiveModelOption?.supportedReasoningEfforts ?? [];
  const effortLabel = selectedEffort ? t(`agent.effort.${selectedEffort}`) : t('agent.effort.default');

  return (
    <div ref={composerRef} className={cn('agent-composer relative z-30 shrink-0 bg-transparent p-2.5', isProcessing && 'agent-composer-processing')}>
      <div className="agent-composer-card border border-border-subtle/80 bg-panel shadow-lg shadow-black/10 transition-colors focus-within:!border-accent-blue/45 hover:border-border-strong/60">
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

        <div className="flex min-h-10 min-w-0 items-start gap-2 px-3 pb-1 pt-2.5">
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
            }}
            onKeyDown={handleKeyDown}
            placeholder={activeCommand ? t('agent.commandArguments') : t('agent.placeholder')}
            rows={1}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showCommandSuggestions}
            aria-controls={showCommandSuggestions ? 'agent-command-suggestions' : undefined}
            aria-activedescendant={showCommandSuggestions ? `agent-command-option-${activeCommandIndex}` : undefined}
            className="agent-composer-input max-h-36 min-h-8 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent p-0 font-sans text-xs leading-5 text-text-primary placeholder:text-text-muted"
          />
        </div>

        {composerError && <div className="px-4 pb-1 text-[11px] text-severity-critical">{composerError}</div>}

        <div className="agent-composer-actions flex min-w-0 items-center gap-0.5 px-2 pb-2 select-none">
          <div className="agent-composer-plus shrink-0">
            <ComposerTrigger active={openMenu === 'attachments'} ariaLabel={t('agent.addFilesImages')} onClick={() => setOpenMenu((current) => current === 'attachments' ? null : 'attachments')} icon="plus" />
          </div>
          <div className="agent-composer-model min-w-0 flex-1">
            <ComposerTrigger active={openMenu === 'model'} ariaLabel={`${t('agent.model')} ${modelLabel}, ${t('agent.effort')} ${effortLabel}`} onClick={() => setOpenMenu((current) => current === 'model' ? null : 'model')} icon="bot" label={<><span className="agent-composer-model-detail truncate">{selectedModelOption?.displayName ?? modelLabel} · {effortLabel}</span><span className="agent-composer-model-short hidden">{t('agent.modelEffortShort')}</span></>} />
          </div>
          <div className="agent-composer-autonomy shrink-0">
            <ComposerTrigger active={openMenu === 'autonomy'} ariaLabel={`${t('agent.autonomy')} ${t(`agent.autonomy.${autonomyLevel}`)}`} onClick={() => setOpenMenu((current) => current === 'autonomy' ? null : 'autonomy')} label={`${t('agent.autonomyShort')}·${t(`agent.autonomyShort.${autonomyLevel}`)}`} />
          </div>
          <div className="agent-composer-mode shrink-0">
            <ComposerTrigger active={openMenu === 'mode'} ariaLabel={`${t('agent.permissionMode')} ${modeLabel}`} onClick={() => setOpenMenu((current) => current === 'mode' ? null : 'mode')} icon="shield" label={<><span className="agent-composer-mode-full">{modeLabel}</span><span className="agent-composer-mode-short hidden">{modeShortLabel}</span></>} danger={permissionMode === 'bypassPermissions'} />
          </div>
          <div className="agent-composer-send ml-auto flex shrink-0 items-center gap-1">
            <button
              aria-label={t('agent.send')}
              onClick={() => void handleSend()}
              disabled={!text.trim() && attachments.length === 0 && contextRefs.length === 0}
              className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text-primary text-canvas transition-colors hover:bg-accent-blue disabled:cursor-not-allowed disabled:bg-raised disabled:text-text-muted"
            >
              <Icon name="send" size={14} />
            </button>
            {isProcessing && (
              <button
                aria-label={t('agent.cancelRequest')}
                onClick={() => void cancelRequest()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-severity-medium/15 text-severity-medium transition-colors hover:bg-severity-medium/25"
              >
                <Icon name="close" size={14} />
              </button>
            )}
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

      {openMenu === 'mode' && <Popover align="right" label={t('agent.permissionMode')} wide>
        <ClaudeModeSelector value={permissionMode} onChange={(mode) => { setPermissionMode(mode); setOpenMenu(null); }} isProcessing={isProcessing} />
      </Popover>}

      {openMenu === 'model' && <Popover align="right" label={t('agent.model')} wide>
        <div className="px-1 pb-2">
          <p className="px-1 pb-1 text-[11px] font-medium text-text-primary">{t('agent.effort')}</p>
          <p className="px-1 pb-2 text-[11px] leading-4 text-text-muted">{t('agent.effortHint')}</p>
          <div className="px-1"><ReasoningEffortSlider value={selectedEffort} efforts={availableEfforts}
            defaultEffort={effectiveModelOption?.defaultReasoningEffort}
            descriptions={effectiveModelOption?.reasoningEffortDescriptions} disabled={isProcessing || !effectiveModelOption}
            onCommit={(effort) => saveModelSettings(selectedModel, effort, false)} /></div>
          {!effectiveModelOption && !modelCatalog.loading && <p className="px-1 pt-1 text-[11px] text-text-muted">{t('agent.chooseModelForEffort')}</p>}
        </div>
        <div className="border-t border-border-subtle pt-2">
          <p className="px-2 pb-1 text-[11px] font-medium text-text-primary">{t('agent.model')}</p>
        <div className="max-h-40 overflow-y-auto">
          <button aria-pressed={!selectedModel} disabled={isProcessing}
            onClick={() => void saveModelSettings(null, null)}
            className={cn('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] hover:bg-raised/50 disabled:opacity-40',
              !selectedModel ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary')}>
            {t('agent.useDefault')}
            {!selectedModel && <Icon name="check" size={11} />}
          </button>
          {modelCatalog.models.map((model) => <button key={model.id}
            aria-pressed={selectedModelOption?.id === model.id}
            disabled={isProcessing} title={model.description || model.id} onClick={() => void saveModelSettings(model.id, model.supportedReasoningEfforts?.includes(selectedEffort as AgentReasoningEffort) ? selectedEffort : null)}
            className={cn('flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-raised/50 disabled:opacity-40',
              selectedModelOption?.id === model.id ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary')}>
            <span className="min-w-0 truncate">{model.displayName}</span>
            {selectedModelOption?.id === model.id && <Icon name="check" size={11} />}
          </button>)}
        </div>
        {modelCatalog.loading && <p className="px-2 py-1.5 text-[11px] text-text-muted">{t('agent.loadingModels')}</p>}
        {modelCatalog.error && <p className="px-2 py-1.5 text-[11px] text-status-error">{t('agent.modelsError')}: {modelCatalog.error}</p>}
        {!modelCatalog.loading && !modelCatalog.error && modelCatalog.models.length === 0 &&
          <p className="px-2 py-1.5 text-[11px] text-text-muted">{t('agent.noModels')}</p>}
        {selectedModel && !modelCatalog.loading && !selectedModelOption &&
          <p className="border-t border-border-subtle px-2 py-1.5 text-[11px] text-text-muted">
            {selectedModel} · {t('agent.modelUnavailable')}
          </p>}
        </div>
      </Popover>}

      {openMenu === 'autonomy' && <Popover align="right" label={t('agent.autonomy')}>
        <p className="px-2 pb-1 text-[11px] leading-4 text-text-muted">{t('agent.autonomyHint')}</p>
        {(['low', 'medium', 'high'] as AutonomyLevel[]).map((level) => (
          <button key={level} aria-pressed={autonomyLevel === level} onClick={() => { setAutonomyLevel(level); setOpenMenu(null); }} className={cn('flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px]', autonomyLevel === level ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-raised/50')}>
            <span><span className="block font-medium">{t(`agent.autonomy.${level}`)}</span><span className="block text-text-muted">{t(`agent.autonomyHint.${level}`)}</span></span>{autonomyLevel === level && <Icon name="check" size={11} />}
          </button>
        ))}
        <p className="mt-1 border-t border-border-subtle px-2 pt-2 text-[11px] leading-4 text-text-muted">{t('agent.autonomyPermissionHint')}</p>
      </Popover>}
    </div>
  );
}

function normalizeSettingsPayload(value: AgentSettingsContainer | AgentConnectionSettings): AgentSettingsContainer {
  const codex = { version: 1 as const, executionMode: 'native' as const, wslDistribution: 'Ubuntu-24.04', codexExecutable: 'codex', model: null, reasoningEffort: null };
  if ('backends' in value) return { ...value, backends: { ...value.backends, codex: value.backends.codex ?? codex } };
  return {
    version: 2,
    defaultBackendId: 'claude',
    backends: { claude: value, codex },
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

function ComposerTrigger({ active, ariaLabel, onClick, icon, label, danger = false }: { active: boolean; ariaLabel: string; onClick: () => void; icon?: 'plus' | 'shield' | 'bot'; label?: React.ReactNode; danger?: boolean }) {
  return <button aria-label={ariaLabel} title={ariaLabel} aria-expanded={active} onClick={onClick} className={cn('flex h-7 min-w-7 max-w-full items-center justify-center gap-1 overflow-hidden rounded-lg px-1.5 text-[11px] font-medium transition-colors', danger ? 'text-severity-critical hover:bg-severity-critical/10' : active ? 'bg-raised text-text-primary' : 'text-text-muted hover:bg-raised/60 hover:text-text-secondary')}>
    {icon && <Icon name={icon} size={13} />}
    {label && <span className="min-w-0 truncate">{label}</span>}
    {label && <Icon name="chevron-right" size={9} className="rotate-90 opacity-60" />}
  </button>;
}

function Popover({ align, label, wide = false, children }: { align: 'left' | 'right'; label: string; wide?: boolean; children: React.ReactNode }) {
  return <div aria-label={label} className={cn('agent-composer-popover ui-popover absolute bottom-[3.25rem] z-20 max-h-72 overflow-y-auto p-2', align === 'left' ? 'left-3' : 'right-3', wide ? 'w-72 max-w-[calc(100%-1.5rem)]' : 'w-56 max-w-[calc(100%-1.5rem)]')}>{children}</div>;
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

function codexCommandCatalog(t: ReturnType<typeof useI18n>['t'], skills: ComposerCommand[]): ComposerCommand[] {
  const commands: ComposerCommand[] = [
    { name: '/distill', description: t('agent.commandDistill'), argumentHint: '', source: 'app' },
    { name: '/compact', description: t('agent.codexCommandCompact'), argumentHint: '', source: 'app' },
    { name: '/context', description: t('agent.codexCommandContext'), argumentHint: '', source: 'app' },
    { name: '/help', description: t('agent.codexCommandHelp'), argumentHint: '', source: 'app' },
    { name: '/status', description: t('agent.codexCommandStatus'), argumentHint: '', source: 'app' },
    { name: '/model', description: t('agent.codexCommandModel'), argumentHint: '', source: 'app' },
    { name: '/permissions', description: t('agent.codexCommandPermissions'), argumentHint: '', source: 'app' },
    { name: '/mcp', description: t('agent.codexCommandMcp'), argumentHint: '', source: 'app' },
    { name: '/new', description: t('agent.codexCommandNew'), argumentHint: '', source: 'app' },
  ];
  const byName = new Map(commands.map((command) => [command.name, command]));
  for (const skill of skills) if (!byName.has(skill.name)) byName.set(skill.name, skill);
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

function completionQuery(content: string) {
  const match = content.match(/^(\/)([^\s]*)$/);
  return match ? `${match[1]}${match[2]}` : null;
}

function commandForText(content: string, commands: ComposerCommand[]) {
  const trimmed = content.trimStart();
  return commands.find((command) => trimmed === command.name || trimmed.startsWith(`${command.name} `)) ?? null;
}

function commandArguments(content: string, commandName: string) {
  return content.trimStart().slice(commandName.length).replace(/^\s+/, '');
}

function replaceCommandToken(content: string, commandName: string) {
  const remainder = content.trimStart().replace(/^\/[^\s]*/, '').replace(/^\s+/, '');
  return `${commandName}${remainder ? ` ${remainder}` : ''}`;
}
