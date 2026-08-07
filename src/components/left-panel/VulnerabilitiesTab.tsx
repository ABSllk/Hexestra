import { useMemo } from 'react';
import { useNetMapStore, useSessionStore } from '@/stores';
import { openRecordTab } from '@/stores/useTabStore';
import type { VulnerabilitySeverity } from '@/types';

export function VulnerabilitiesTab({ onRecordContextMenu }: {
  onRecordContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => void;
} = {}) {
  const records = useSessionStore((state) => state.vulnerabilities);
  const nodes = useNetMapStore((state) => state.nodes);
  const selectNode = useNetMapStore((state) => state.selectNode);
  const labels = useMemo(() => new Map(nodes.map((node) => [node.id, node.label])), [nodes]);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{records.length === 0 ? <div className="p-4 text-center text-2xs text-text-muted">No validated vulnerabilities.</div> : records.map((record) => <button key={record.id} onClick={() => { selectNode(record.assetId); openRecordTab('vulnerability', record.id, record.title); }} onContextMenu={(event) => onRecordContextMenu?.(event, record.id)} className="ui-hover-row mb-1 w-full min-w-0 px-2.5 py-2 text-left"><div className="mb-1 flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 flex-1 truncate text-2xs font-medium text-text-primary">{record.title}</span><Severity value={record.severity} /></div><div className="flex min-w-0 items-center justify-between gap-2 font-mono text-[8px] uppercase text-text-muted"><span className="min-w-0 truncate">{labels.get(record.assetId) ?? record.assetId}</span><span className="shrink-0">{record.status}</span></div></button>)}</div>
  </div>;
}

function Severity({ value }: { value: VulnerabilitySeverity }) { const color = value === 'critical' ? 'text-severity-critical' : value === 'high' ? 'text-severity-high' : value === 'medium' ? 'text-severity-medium' : 'text-text-muted'; return <span className={`font-mono text-[8px] uppercase ${color}`}>{value}</span>; }
