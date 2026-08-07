import { useMemo, useState } from 'react';
import { Icon } from '@/components/shared';
import { useNetMapStore, useSessionStore } from '@/stores';
import { openRecordTab } from '@/stores/useTabStore';
import type { FindingConfidence, FindingKind } from '@/types';

const KINDS: FindingKind[] = ['observation', 'lead', 'hypothesis', 'behavior', 'access', 'note'];
const CONFIDENCES: FindingConfidence[] = ['low', 'medium', 'high'];

export function FindingsTab({ showHeader = true, onRecordContextMenu }: {
  showHeader?: boolean;
  onRecordContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, recordId: string) => void;
}) {
  const findings = useSessionStore((state) => state.findings);
  const upsertFinding = useSessionStore((state) => state.upsertFinding);
  const nodes = useNetMapStore((state) => state.nodes);
  const selectedNodeId = useNetMapStore((state) => state.selectedNodeId);
  const selectNode = useNetMapStore((state) => state.selectNode);
  const [showCreate, setShowCreate] = useState(false);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const assets = nodes.filter((node) => node.type !== 'local' && !node.virtual);

  return <div className="flex h-full min-h-0 flex-col">
    {showHeader && <div className="flex shrink-0 items-center justify-between border-b border-surface bg-bg-tertiary/50 px-3 py-2">
      <div><div className="text-xs font-medium text-text-secondary">Findings</div><div className="text-[9px] text-text-muted">Reusable project knowledge</div></div>
      <button aria-label="Create finding" onClick={() => setShowCreate((value) => !value)} className="ui-icon-button h-7 w-7 border-surface text-accent-blue hover:bg-accent-blue/10"><Icon name="plus" size={13} /></button>
    </div>}
    {showCreate && <CreateFinding
      initialAssetId={assets.some((node) => node.id === selectedNodeId) ? selectedNodeId! : ''}
      assets={assets.map((node) => ({ id: node.id, label: node.label }))}
      onCreate={async (input) => {
        const result = await upsertFinding(input);
        if (result) openRecordTab('finding', result.id, result.title);
        setShowCreate(false);
      }}
    />}
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {findings.length === 0 ? <div className="p-4 text-center text-2xs text-text-muted">No reusable findings yet.</div> : findings.map((finding) => <button
        key={finding.id}
        onClick={() => { if (finding.assetId) selectNode(finding.assetId); openRecordTab('finding', finding.id, finding.title); }}
        onContextMenu={(event) => onRecordContextMenu?.(event, finding.id)}
        className="ui-hover-row mb-1 w-full px-2.5 py-2 text-left"
      >
        <div className="mb-1 flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 flex-1 truncate text-2xs font-medium leading-relaxed text-text-primary">{finding.title}</span><span className="shrink-0 font-mono text-[8px] uppercase text-accent-teal">{finding.kind}</span></div>
        <div className="flex min-w-0 items-center justify-between gap-2 font-mono text-[8px] uppercase text-text-muted"><span className="min-w-0 truncate">{finding.assetId ? nodeById.get(finding.assetId)?.label ?? finding.assetId : 'Project'}</span><span className="shrink-0">{finding.confidence} / {finding.status}</span></div>
      </button>)}
    </div>
  </div>;
}

function CreateFinding({ initialAssetId, assets, onCreate }: {
  initialAssetId: string;
  assets: Array<{ id: string; label: string }>;
  onCreate: (input: { assetId?: string; title: string; kind: FindingKind; confidence: FindingConfidence }) => Promise<void>;
}) {
  const [assetId, setAssetId] = useState(initialAssetId);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<FindingKind>('observation');
  const [confidence, setConfidence] = useState<FindingConfidence>('medium');
  return <div className="shrink-0 space-y-2 border-b border-surface bg-bg-tertiary/70 p-3">
    <select aria-label="Finding asset" value={assetId} onChange={(event) => setAssetId(event.target.value)} className="ui-control h-7 w-full px-2 text-2xs text-text-primary"><option value="">Project-level</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select>
    <input aria-label="Finding title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Useful information or lead" className="ui-control h-7 w-full px-2 text-2xs text-text-primary" />
    <div className="flex gap-2"><select aria-label="Finding kind" value={kind} onChange={(event) => setKind(event.target.value as FindingKind)} className="h-7 min-w-0 flex-1 rounded border border-surface bg-bg-primary px-2 text-2xs text-text-primary">{KINDS.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Finding confidence" value={confidence} onChange={(event) => setConfidence(event.target.value as FindingConfidence)} className="h-7 min-w-0 flex-1 rounded border border-surface bg-bg-primary px-2 text-2xs text-text-primary">{CONFIDENCES.map((value) => <option key={value}>{value}</option>)}</select><button disabled={!title.trim()} onClick={() => void onCreate({ assetId: assetId || undefined, title: title.trim(), kind, confidence })} className="rounded border border-accent-blue/40 px-3 text-2xs text-accent-blue disabled:opacity-30">Add</button></div>
  </div>;
}
