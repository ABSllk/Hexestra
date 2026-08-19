import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { useI18n } from '@/i18n';

export function ConversationSelector() {
  const { t } = useI18n();
  const activeProjectId = useChatStore((state) => state.activeProjectId);
  const activeBranchId = useChatStore((state) => state.activeBranchId);
  const branches = useChatStore((state) => state.branches);
  const newConversation = useChatStore((state) => state.newConversation);
  const switchBranch = useChatStore((state) => state.switchBranch);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = 'agent-conversation-listbox';
  const activeIndex = Math.max(0, branches.findIndex((branch) => branch.id === activeBranchId));
  const activeConversation = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  useEffect(() => {
    if (!open) return;

    setHighlightedIndex(activeIndex);
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

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
    <div className="relative flex shrink-0 items-center gap-1.5 border-b border-border-subtle/70 bg-panel/70 px-2.5 py-2" ref={selectorRef}>
      <div className="relative min-w-0 flex-1">
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={t('agent.selectConversation')}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            'ui-control flex min-h-9 w-full min-w-0 items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] text-text-secondary',
            open && 'border-accent-blue/50 bg-panel shadow-lg shadow-black/20',
          )}
          disabled={!activeProjectId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-raised/65 text-text-muted">
              <Icon name="message" size={11} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-text-primary">
                {activeConversation?.title ?? t('agent.noConversation')}
              </span>
              <span className="block truncate font-mono text-[10px] text-text-muted">
                {activeConversation ? t('agent.messagesCount', { count: activeConversation.messageCount }) : t('agent.conversationCount', { count: 0 })}
              </span>
            </span>
          </span>
          <Icon name="chevron-down" size={13} className={cn('text-text-muted transition-transform', open && 'rotate-180 text-accent-blue')} />
        </button>

        {open && (
          <div id={listboxId} role="listbox" aria-label={t('agent.selectConversation')} className="ui-popover absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto p-1.5">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{t('agent.conversations')}</span>
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
                      'group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      selected ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-transparent',
                      highlighted && !selected && 'bg-raised/65',
                      'hover:border-border-subtle hover:bg-raised/70',
                    )}
                    onClick={() => selectConversation(conversation.id)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index, conversation.id)}
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', selected ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue' : 'border-border-subtle bg-panel text-text-muted')}>
                      <Icon name={selected ? 'check' : 'message'} size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[11px] font-medium', selected ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary')}>
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-text-muted">
                        {t('agent.messagesCount', { count: conversation.messageCount })}
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
      <button
        aria-label={t('agent.newConversation')}
        className="ui-icon-button h-9 w-9 border-border-subtle bg-panel/40 hover:border-accent-blue/30 hover:bg-accent-blue/10 hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!activeProjectId}
        onClick={() => { setOpen(false); void newConversation(); }}
        title={t('agent.newConversation')}
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}
