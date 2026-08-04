import { useMemo } from 'react';
import { Icon } from '@/components/shared';
import { useChatStore, useNetMapStore } from '@/stores';

export function ContextIndicator() {
  const contextTabs = useChatStore((state) => state.contextTabs);
  const toggleTabSharing = useChatStore((state) => state.toggleTabSharing);
  const nodes = useNetMapStore((state) => state.nodes);
  const edges = useNetMapStore((state) => state.edges);
  const selectedNodeId = useNetMapStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const relationshipCount = useMemo(
    () => edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId).length,
    [edges, selectedNodeId],
  );

  if (contextTabs.length === 0 && !selectedNode) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-surface/50 bg-bg-tertiary/50 px-3 py-1.5"
      title="Context shared with Claude"
    >
      <Icon name="eye" size={12} className="shrink-0 text-accent-teal" />
      <div className="flex min-w-0 flex-wrap gap-1">
        {selectedNode && (
          <span
            className="rounded-md border border-accent-blue/25 bg-accent-blue/10 px-1.5 py-0.5 text-[9px] text-accent-blue"
            title={`${relationshipCount} asset relationship${relationshipCount === 1 ? '' : 's'} shared automatically`}
          >
            {selectedNode.label} · {relationshipCount}
          </span>
        )}
        {contextTabs.map((tab) => (
          <button
            key={tab.tabId}
            onClick={() => toggleTabSharing(tab.tabId)}
            className={tab.isShared
              ? 'rounded-md border border-accent-teal/25 bg-accent-teal/10 px-1.5 py-0.5 text-[9px] text-accent-teal hover:border-accent-teal/45 hover:bg-accent-teal/15'
              : 'rounded-md border border-surface px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-surface/35 hover:text-text-secondary'}
            title={tab.isShared ? 'Click to hide from AI' : 'Click to share with AI'}
          >
            {tab.title}
          </button>
        ))}
      </div>
    </div>
  );
}
