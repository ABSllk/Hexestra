import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Icon, IconButton, PanelHeader } from '@/components/shared';
import { useChatStore, useSessionStore, useTabStore } from '@/stores';
import { openSettingsTab } from '@/stores/useTabStore';
import { buildSelectedRecordContextTab } from '@/lib/agentRecordContext';
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
  const attentionItems = useChatStore((s) => s.attentionItems);
  const openAttention = useChatStore((s) => s.openAttention);
  const clearAttention = useChatStore((s) => s.clearAttention);
  const [inboxOpen, setInboxOpen] = useState(false);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const findings = useSessionStore((s) => s.findings);
  const vulnerabilities = useSessionStore((s) => s.vulnerabilities);
  const evidenceRecords = useSessionStore((s) => s.evidenceRecords);
  const reports = useSessionStore((s) => s.reports);
  const contextTabs = useMemo(
    () => {
      const sharedTabs = tabs
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
        }));
      const selectedRecord = buildSelectedRecordContextTab(
        tabs.find((tab) => tab.id === activeTabId),
        { findings, vulnerabilities, evidenceRecords, reports },
      );
      return selectedRecord ? [...sharedTabs, selectedRecord] : sharedTabs;
    },
    [activeTabId, evidenceRecords, findings, reports, tabs, vulnerabilities],
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
        actions={<div className="flex items-center gap-1">
          <div className="relative">
            <IconButton name="bell" label={t('agent.inbox')} size={14} onClick={() => setInboxOpen((open) => !open)} />
            {attentionItems.some((item) => !item.read) && <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-status-warning" />}
            {inboxOpen && (
              <div className="ui-popover absolute right-0 top-full z-40 mt-2 w-72 p-1.5">
                <div className="px-2 py-1 text-[11px] font-semibold text-text-primary">{t('agent.inbox')}</div>
                {attentionItems.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-text-muted">{t('agent.inboxEmpty')}</div>
                ) : attentionItems.slice().reverse().map((item) => (
                  <div key={item.id} className="flex items-start gap-2 rounded px-2 py-2 text-left hover:bg-raised/60">
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setInboxOpen(false); void openAttention(item); }}>
                      <span className="block truncate text-[11px] font-medium text-text-primary">{item.title}</span>
                      <span className="block truncate text-[10px] text-text-muted">{item.detail || `${item.projectId} · ${item.branchId}`}</span>
                    </button>
                    {!item.kind.startsWith('waiting_') && (
                      <button aria-label={t('common.clear')} className="shrink-0 rounded p-1 text-text-muted hover:text-text-primary" onClick={() => void clearAttention(item.id)}>
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <IconButton name="settings" label={t('agent.openSettings')} size={14} onClick={() => openSettingsTab('connection')} />
        </div>}
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
