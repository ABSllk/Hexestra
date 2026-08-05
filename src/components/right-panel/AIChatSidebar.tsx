import { useEffect, useMemo } from 'react';
import { Icon } from '@/components/shared';
import { useChatStore, useTabStore } from '@/stores';
import { openSettingsTab } from '@/stores/useTabStore';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ConversationSelector } from './ConversationSelector';
import { ContextIndicator } from './ContextIndicator';
import { AgentInteractionCard } from './AgentInteractionCard';
import { useI18n } from '@/i18n';

export function AIChatSidebar() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const subscribeToAgent = useChatStore((s) => s.subscribeToAgent);
  const syncContextTabs = useChatStore((s) => s.syncContextTabs);
  const pendingToolRequest = useChatStore((s) => s.pendingToolRequest);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const tabs = useTabStore((s) => s.tabs);
  const contextTabs = useMemo(
    () =>
      tabs
        .filter((tab) => tab.type === 'terminal' || tab.type === 'editor' || tab.type === 'browser' || tab.type === 'traffic' || tab.type === 'report')
        .map((tab) => ({
          tabId: tab.id,
          title: tab.title,
          type: tab.type as 'terminal' | 'editor' | 'browser' | 'traffic' | 'report',
          contentPreview: String(
            tab.data?.contentPreview ??
            tab.data?.content ??
            tab.data?.url ??
            '',
          ),
        })),
    [tabs],
  );

  useEffect(() => subscribeToAgent(), [subscribeToAgent]);
  useEffect(() => syncContextTabs(contextTabs), [contextTabs, syncContextTabs]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-surface bg-bg-tertiary px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon name="bot" size={15} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-secondary">{t('agent.assistant')}</span>
          <span
            className={
              agentStatus.state === 'error'
                ? 'h-1.5 w-1.5 rounded-full bg-severity-critical'
                : agentStatus.state === 'ready'
                  ? 'h-1.5 w-1.5 rounded-full bg-accent-green'
                  : 'h-1.5 w-1.5 rounded-full bg-severity-medium'
            }
            title={agentStatus.lastError ?? `Claude SDK: ${agentStatus.state}`}
          />
          {isProcessing && (
            <span className="typing-indicator ml-1 flex gap-0.5" aria-label={t('agent.processing')}>
              <span className="h-1 w-1 rounded-full bg-accent-blue" />
              <span className="h-1 w-1 rounded-full bg-accent-blue" />
              <span className="h-1 w-1 rounded-full bg-accent-blue" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={t('agent.openSettings')}
            onClick={() => openSettingsTab('connection')}
            className="ui-icon-button p-1"
            title={t('agent.openSettings')}
          >
            <Icon name="settings" size={14} />
          </button>
        </div>
      </div>

      <ConversationSelector />

      <ContextIndicator />

      {agentStatus.state === 'error' && agentStatus.lastError && (
        <div className="border-b border-severity-critical/20 bg-severity-critical/10 px-3 py-2 text-2xs text-severity-critical">
          {agentStatus.lastError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="chat-workspace">
        <div className="min-h-0 flex-1">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-text-muted">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-accent-blue/15 bg-accent-blue/5 transition-colors hover:border-accent-blue/30 hover:bg-accent-blue/10">
                <Icon name="message" size={24} className="text-accent-blue/70" />
              </div>
              <p className="text-center text-xs font-medium text-text-secondary">{t('agent.startConversation')}</p>
              <p className="mt-1 text-center text-2xs">{t('agent.emptyHint')}</p>
            </div>
          ) : (
            <ChatMessages />
          )}
        </div>

        {pendingToolRequest && (
          <div
            className="relative z-20 max-h-[60%] min-h-0 shrink-0 overflow-y-auto overscroll-contain"
            data-testid="agent-interaction-dock"
          >
            <AgentInteractionCard key={pendingToolRequest.id} request={pendingToolRequest} />
          </div>
        )}
        <ChatInput />
      </div>
    </div>
  );
}
