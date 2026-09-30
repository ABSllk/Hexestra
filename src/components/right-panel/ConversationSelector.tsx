import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { useI18n } from '@/i18n';

export function ConversationSelector({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const activeProjectId = useChatStore((state) => state.activeProjectId);
  const activeBranchId = useChatStore((state) => state.activeBranchId);
  const branches = useChatStore((state) => state.branches);
  const newConversation = useChatStore((state) => state.newConversation);
  const switchBranch = useChatStore((state) => state.switchBranch);
  const [open, setOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const newTriggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = 'agent-conversation-listbox';
  const activeIndex = Math.max(0, branches.findIndex((branch) => branch.id === activeBranchId));

  useEffect(() => {
    setOpen(false);
    setNewMenuOpen(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (!open) return;

    setHighlightedIndex(activeIndex);
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open && !newMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) { setOpen(false); setNewMenuOpen(false); }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setNewMenuOpen(false);
        (newMenuOpen ? newTriggerRef : triggerRef).current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, newMenuOpen]);

  const focusOption = (index: number) => {
    if (branches.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, branches.length - 1));
    setHighlightedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const selectConversation = (branchId: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (branchId !== activeBranchId) void switchBranch(branchId);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen?.();
      setNewMenuOpen(false);
      setOpen(true);
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number, branchId: string) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(branches.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectConversation(branchId);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1" ref={selectorRef}>
      <div>
        <button
          ref={triggerRef}
          type="button"
          aria-label={t('agent.conversationHistory')}
          title={t('agent.conversationHistory')}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            'ui-icon-button h-7 w-7 disabled:cursor-not-allowed disabled:opacity-40',
            open && 'bg-raised text-text-primary',
          )}
          disabled={!activeProjectId}
          onClick={() => { onOpen?.(); setNewMenuOpen(false); setOpen((current) => !current); }}
          onKeyDown={handleTriggerKeyDown}
        >
          <Icon name="history" size={14} />
        </button>

        {open && (
          <div id={listboxId} role="listbox" aria-label={t('agent.conversationHistory')} className="ui-popover absolute right-2.5 top-11 z-50 max-h-[min(18rem,calc(100%-3.5rem))] w-72 max-w-[calc(100%-1.25rem)] overflow-y-auto p-1.5">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[11px] font-semibold text-text-secondary">{t('agent.conversationHistory')}</span>
              <span className="font-mono text-[10px] text-text-muted">{t('agent.conversationCount', { count: branches.length })}</span>
            </div>
            {branches.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-text-muted">{t('agent.noConversation')}</div>
            ) : (
              branches.map((conversation, index) => {
                const selected = conversation.id === activeBranchId;
                const highlighted = highlightedIndex === index;
                return (
                  <button
                    key={conversation.id}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus',
                      selected && 'bg-accent-blue/10',
                      highlighted && !selected && 'bg-raised/65',
                      'hover:bg-raised/70',
                    )}
                    onClick={() => selectConversation(conversation.id)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index, conversation.id)}
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', selected ? 'bg-accent-blue/15 text-accent-blue' : 'bg-raised/65 text-text-muted')}>
                      <Icon name={selected ? 'check' : 'message'} size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[11px] font-medium', selected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary')}>
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">
                        {conversation.backendId === 'codex' ? 'Codex' : 'Claude'} · {t('agent.messagesCount', { count: conversation.messageCount })}
                      </span>
                    </span>
                    {selected && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-blue">{t('agent.active')}</span>}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      <div>
      <button
        ref={newTriggerRef}
        aria-label={t('agent.newConversation')}
        aria-expanded={newMenuOpen}
        type="button"
        className="ui-icon-button h-7 w-7 hover:bg-accent-blue/10 hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!activeProjectId}
        onClick={() => { onOpen?.(); setOpen(false); setNewMenuOpen((value) => !value); }}
        title={t('agent.newConversation')}
      >
        <Icon name="plus" size={13} />
      </button>
      {newMenuOpen && <div className="ui-popover absolute right-2.5 top-11 z-50 max-h-[calc(100%-3.5rem)] w-36 max-w-[calc(100%-1.25rem)] overflow-y-auto p-1.5">
        {(['claude', 'codex'] as const).map((backendId) => <button key={backendId} type="button"
          className="w-full rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-raised hover:text-text-primary"
          onClick={() => { setNewMenuOpen(false); newTriggerRef.current?.focus(); void newConversation(backendId); }}>
          {backendId === 'claude' ? 'Claude' : 'Codex'}
        </button>)}
      </div>}
      </div>
    </div>
  );
}
