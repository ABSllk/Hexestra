import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentConnectionSettings, AgentSettingsContainer } from '@electron/contracts/agent-settings';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { agentContextRefKey, type AgentAttachment, type AgentAttachmentPicker, type AgentContextRef, type AutonomyLevel } from '@/types';
import { ClaudeModeSelector } from './ClaudeModeSelector';
import { useI18n } from '@/i18n';

type ComposerMenu = 'attachments' | 'mode' | 'model' | 'autonomy' | null;

export function ChatInput() {
  const { t } = useI18n();
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [connectionSettings, setConnectionSettings] = useState<AgentSettingsContainer | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
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

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.placeholder')}
          rows={2}
          className="max-h-36 min-h-16 w-full resize-none bg-transparent px-4 pb-2 pt-3 font-sans text-xs leading-5 text-text-primary focus-visible:outline-none placeholder:text-text-muted select-none rounded-xl border-0"
          disabled={isProcessing}
        />

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
