import { Icon } from '@/components/shared';
import { useChatStore } from '@/stores';

export function ConversationSelector() {
  const activeProjectId = useChatStore((state) => state.activeProjectId);
  const activeBranchId = useChatStore((state) => state.activeBranchId);
  const branches = useChatStore((state) => state.branches);
  const isProcessing = useChatStore((state) => state.isProcessing);
  const newConversation = useChatStore((state) => state.newConversation);
  const switchBranch = useChatStore((state) => state.switchBranch);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle/70 bg-panel/70 px-2.5 py-2">
      <select
        aria-label="Select conversation"
        className="ui-control min-w-0 flex-1 px-2.5 py-1.5 text-[11px] text-text-secondary disabled:opacity-50"
        disabled={!activeProjectId || isProcessing}
        onChange={(event) => void switchBranch(event.target.value)}
        value={activeBranchId}
      >
        {branches.map((conversation) => (
          <option key={conversation.id} value={conversation.id}>
            {conversation.title} · {conversation.messageCount}
          </option>
        ))}
      </select>
      <button
        aria-label="New conversation"
        className="ui-icon-button border-border-subtle hover:border-accent-blue/30 hover:bg-accent-blue/10 hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!activeProjectId || isProcessing}
        onClick={() => void newConversation()}
        title="New conversation"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}
