import { Icon, StatusBadge } from '@/components/shared';
import { listOpenPorts } from '@/lib/targetPresentation';
import { useNetMapStore, useSessionStore } from '@/stores';
import type { AssetRecord, GraphNode } from '@/types';

export function TargetsTab() {
  const targets = useSessionStore((s) => s.targets);
  const assets = useSessionStore((s) => s.assets);
  const nodes = useNetMapStore((s) => s.nodes);
  const selectedNodeId = useNetMapStore((s) => s.selectedNodeId);
  const selectNode = useNetMapStore((s) => s.selectNode);

  const visibleNodes = nodes.filter((node) => node.type !== 'local');

  if (visibleNodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-text-muted">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-surface bg-bg-tertiary">
          <Icon name="target" size={22} />
        </div>
        <p className="mb-1 text-center text-xs font-medium text-text-secondary">No assets yet</p>
        <p className="text-center text-2xs">
          Run a host, domain, or web scan to populate the attack surface.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-surface bg-bg-tertiary/50 px-3 py-2 text-2xs text-text-muted">
        {visibleNodes.length} asset{visibleNodes.length !== 1 ? 's' : ''} discovered
      </div>
      <div className="flex-1 overflow-y-auto">
        {visibleNodes.map((node) => {
          const target = targets.find((candidate) => candidate.id === node.id);
          const asset = assets.find((candidate) => candidate.id === node.id);
          return (
          <button
            key={node.id}
            onClick={() => selectNode(node.id)}
            className={`w-full border-b border-surface/50 px-3 py-2 text-left transition-colors hover:bg-surface/30 ${
              selectedNodeId === node.id ? 'border-l-2 border-l-accent-blue bg-accent-blue/10' : ''
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="min-w-0 truncate font-mono text-xs font-medium text-text-primary">{node.label}</span>
              <StatusBadge status={node.status} />
            </div>
            <div className="flex items-center gap-3 text-2xs text-text-muted">
              <span className="uppercase text-accent-teal">{node.type}</span>
              <span className="min-w-0 truncate">
                {target?.ip ?? assetPrimaryValue(asset) ?? node.key ?? node.label}
              </span>
              {node.portCount > 0 && <span>{node.portCount} ports</span>}
              {node.vulnCount > 0 && (
                <span className="font-medium text-severity-high">{node.vulnCount} vulns</span>
              )}
            </div>
          </button>
          );
        })}
      </div>

      {selectedNodeId && <NodeDetailPanel nodeId={selectedNodeId} />}
    </div>
  );
}

function NodeDetailPanel({ nodeId }: { nodeId: string }) {
  const targets = useSessionStore((s) => s.targets);
  const assets = useSessionStore((s) => s.assets);
  const nodes = useNetMapStore((s) => s.nodes);
  const target = targets.find((candidate) => candidate.id === nodeId);
  const asset = assets.find((candidate) => candidate.id === nodeId);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const openPorts = target ? listOpenPorts(target) : [];

  return (
    <div className="max-h-72 shrink-0 overflow-y-auto border-t border-surface bg-bg-tertiary/50">
      <div className="flex items-center justify-between border-b border-surface/50 px-3 py-2">
        <span className="text-xs font-semibold text-text-secondary">Details</span>
        <StatusBadge status={node.status} />
      </div>
      <div className="space-y-2 p-3 text-2xs">
        <DetailRow label="Type" value={node.type} />
        {target && <DetailRow label="IP" value={target.ip} mono />}
        {target?.hostname && <DetailRow label="Hostname" value={target.hostname} />}
        {target?.os && <DetailRow label="OS" value={target.os} />}
        {asset && Object.entries(asset.properties).map(([label, value]) => (
          <DetailRow key={label} label={humanize(label)} value={formatProperty(value)} mono={label === 'url' || label === 'domain'} />
        ))}
        {target && <DetailRow label="Open Ports" value={String(openPorts.length)} />}
        <DetailRow
          label="Vulnerabilities"
          value={String(node.vulnCount)}
          danger={node.vulnCount > 0}
        />
        {target && <div className="border-t border-surface/70 pt-2">
          <div className="mb-1.5 flex items-center justify-between font-medium text-text-muted">
            <span>Open Ports &amp; Services</span>
            <span className="font-mono">{openPorts.length}</span>
          </div>
          {openPorts.length > 0 ? (
            <div className="space-y-1.5">
              {openPorts.map((port) => (
                <div key={port.id} className="rounded border border-surface bg-bg-primary/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-accent-teal">{port.endpoint}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-status-success">
                      {port.state}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-[48px_1fr] gap-x-2 leading-relaxed">
                    <span className="text-text-muted">Service</span>
                    <span className="break-words font-mono text-text-primary">{port.service}</span>
                    {port.serviceDetail && (
                      <>
                        <span className="text-text-muted">Version</span>
                        <span className="break-words font-mono text-text-secondary">
                          {port.serviceDetail}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded border border-dashed border-surface px-2 py-3 text-center text-text-muted">
              No open ports observed
            </div>
          )}
        </div>}
        {(target?.aiSummary || asset?.aiSummary) && (
          <div className="rounded border border-surface bg-bg-primary/40 p-2 leading-relaxed text-text-secondary">
            <div className="mb-1 font-medium text-text-muted">AI Summary</div>
            {target?.aiSummary ?? asset?.aiSummary}
          </div>
        )}
      </div>
    </div>
  );
}

function assetPrimaryValue(asset?: AssetRecord) {
  if (!asset) return undefined;
  const value = asset.properties.url ?? asset.properties.domain ?? asset.properties.ip;
  return typeof value === 'string' ? value : asset.key;
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function formatProperty(value: AssetRecord['properties'][string]) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function DetailRow({
  label,
  value,
  mono = false,
  danger = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div>
      <span className="text-text-muted">{label}: </span>
      <span
        className={`${mono ? 'font-mono' : 'capitalize'} ${
          danger ? 'text-severity-high' : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
