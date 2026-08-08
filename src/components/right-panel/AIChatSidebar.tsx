import { useEffect, useMemo } from 'react';
import { EmptyState, Icon, IconButton, PanelHeader } from '@/components/shared';
import { useChatStore, useTabStore } from '@/stores';
import { openSettingsTab } from '@/stores/useTabStore';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ConversationSelector } from './ConversationSelector';
import { ContextIndicator } from './ContextIndicator';
import { AgentInteractionCard } from './AgentInteractionCard';
import { SubagentDetailView } from './SubagentDetailView';
import { useI18n } from '@/i18n';

export function AIChatSidebar() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const subscribeToAgent = useChatStore((s) => s.subscribeToAgent);
  const syncContextTabs = useChatStore((s) => s.syncContextTabs);
  const pendingToolRequest = useChatStore((s) => s.pendingToolRequest);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const subagentView = useChatStore((s) => s.subagentView);
  const selectedSubagentRunId = useChatStore((s) => s.selectedSubagentRunId);
  const subagentRuns = useChatStore((s) => s.subagentRuns);
  const closeSubagent = useChatStore((s) => s.closeSubagent);
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

  const selectedSubagent = subagentRuns.find((run) => run.id === selectedSubagentRunId);

  if (subagentView === 'subagent-detail' && selectedSubagent) {
    return <SubagentDetailView run={selectedSubagent} onBack={closeSubagent} />;
  }

  if (subagentView === 'subagent-detail') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
        <PanelHeader
          title={t('agent.subagent')}
          actions={<IconButton name="chevron-right" label={t('agent.subagentBack')} size={15} className="rotate-180" onClick={closeSubagent} />}
        />
        <EmptyState icon="bot" title={t('agent.subagentUnavailable')} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader
        title={<span className="flex items-center gap-2"><Icon name="bot" size={15} className="text-accent-blue" /><span>{t('agent.assistant')}</span>
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
        </span>}
        actions={<IconButton name="settings" label={t('agent.openSettings')} size={14} onClick={() => openSettingsTab('connection')} />}
      />

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
            <EmptyState icon="message" title={t('agent.startConversation')} description={t('agent.emptyHint')} />
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
