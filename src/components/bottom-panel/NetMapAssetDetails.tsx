import { Icon, StatusBadge } from '@/components/shared';
import { listOpenPorts } from '@/lib/targetPresentation';
import { useChatStore, useNetMapStore, usePentestTreeStore, useSessionStore } from '@/stores';
import type { AssetRecord } from '@/types';

interface NetMapAssetDetailsProps {
  nodeId: string;
  onClose: () => void;
}

export function NetMapAssetDetails({ nodeId, onClose }: NetMapAssetDetailsProps) {
  const targets = useSessionStore((state) => state.targets);
  const assets = useSessionStore((state) => state.assets);
  const session = useSessionStore((state) => state.currentSession);
  const nodes = useNetMapStore((state) => state.nodes);
  const upsertTask = usePentestTreeStore((state) => state.upsertTask);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const isProcessing = useChatStore((state) => state.isProcessing);
  const target = targets.find((candidate) => candidate.id === nodeId);
  const asset = assets.find((candidate) => candidate.id === nodeId);
  const node = nodes.find((candidate) => candidate.id === nodeId);

  if (!node) return null;

  const openPorts = target ? listOpenPorts(target) : [];
  const requestRescan = async () => {
    await upsertTask({
      id: `asm-rescan-${node.id}`,
      stage: 'S2',
      title: `Rescan ${node.label}`,
      status: 'in_progress',
    });
    await sendMessage(
      `Rescan the selected asset ${node.label} (${target?.ip ?? node.key ?? node.id}). `
      + `First verify it against the project Scope ${JSON.stringify(session?.scope ?? {})}, `
      + 'use the smallest appropriate scan action, then update the asset, change record, and task status.',
    );
  };

  return (
    <aside
      aria-label={`Asset details for ${node.label}`}
      className="pointer-events-auto flex max-h-full w-[min(320px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-accent-teal/25 bg-[#071014]/95 shadow-2xl shadow-black/50 backdrop-blur-md"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-cyan-300/10 px-3 py-2">
        <div className="min-w-0">
          <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-accent-teal/70">Selected asset</div>
          <div className="truncate font-mono text-xs font-semibold text-text-primary">{node.label}</div>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <StatusBadge status={node.status} />
          <button type="button" className="ui-icon-button h-6 w-6" onClick={onClose} aria-label="Close asset details" title="Close asset details">
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-2xs">
        <DetailRow label="Type" value={node.type} />
        {target && <DetailRow label="IP" value={target.ip} mono />}
        {target?.hostname && <DetailRow label="Hostname" value={target.hostname} />}
        {target?.os && <DetailRow label="OS" value={target.os} />}
        {asset && Object.entries(asset.properties).map(([label, value]) => (
          <DetailRow
            key={label}
            label={humanize(label)}
            value={formatProperty(value)}
            mono={label === 'url' || label === 'domain'}
          />
        ))}
        <DetailRow label="Vulnerabilities" value={String(node.vulnCount)} danger={node.vulnCount > 0} />

        {target && (
          <div className="border-t border-surface/70 pt-2">
            <div className="mb-1.5 flex items-center justify-between font-medium text-text-muted">
              <span>Open Ports &amp; Services</span>
              <span className="font-mono">{openPorts.length}</span>
            </div>
            {openPorts.length > 0 ? (
              <div className="space-y-1.5">
                {openPorts.map((port) => (
                  <div key={port.id} className="ui-card p-2 transition-colors hover:border-accent-teal/20 hover:bg-bg-primary/60">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-accent-teal">{port.endpoint}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-status-success">{port.state}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-[48px_1fr] gap-x-2 leading-relaxed">
                      <span className="text-text-muted">Service</span>
                      <span className="break-words font-mono text-text-primary">{port.service}</span>
                      {port.serviceDetail && (
                        <>
                          <span className="text-text-muted">Version</span>
                          <span className="break-words font-mono text-text-secondary">{port.serviceDetail}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-surface px-2 py-3 text-center text-text-muted">No open ports observed</div>
            )}
          </div>
        )}

        {(target?.aiSummary || asset?.aiSummary) && (
          <div className="rounded border border-surface bg-bg-primary/40 p-2 leading-relaxed text-text-secondary">
            <div className="mb-1 font-medium text-text-muted">AI Summary</div>
            {target?.aiSummary ?? asset?.aiSummary}
          </div>
        )}

        <button
          disabled={isProcessing || node.status === 'out_of_scope'}
          onClick={() => void requestRescan()}
          className="flex w-full items-center justify-center gap-2 rounded border border-accent-teal/30 bg-accent-teal/5 px-2 py-1.5 text-accent-teal hover:bg-accent-teal/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="activity" size={12} />
          {node.status === 'out_of_scope' ? 'Out of scope' : 'Rescan with Agent'}
        </button>
      </div>
    </aside>
  );
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function formatProperty(value: AssetRecord['properties'][string]) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function DetailRow({ label, value, mono = false, danger = false }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div>
      <span className="text-text-muted">{label}: </span>
      <span className={`${mono ? 'font-mono' : 'capitalize'} ${danger ? 'text-severity-high' : 'text-text-primary'}`}>{value}</span>
    </div>
  );
}
