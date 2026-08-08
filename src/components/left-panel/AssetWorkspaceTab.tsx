import { useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, Icon, StatusBadge, type ContextMenuItem } from '@/components/shared';
import { useAppStore, useChatStore, useNetMapStore, usePentestTreeStore, useSessionStore } from '@/stores';
import { openBrowserTab } from '@/stores/useTabStore';
import { assetBrowserUrl, assetJsonPayload, assetPrimaryValue, buildAssetRescanPlan } from '@/lib/assetActions';
import type { SessionScope } from '@/types';
import { useI18n } from '@/i18n';

type AssetView = 'inventory' | 'changes' | 'scope';
type AssetMenuState = { nodeId: string; x: number; y: number; target: HTMLButtonElement };

export function AssetWorkspaceTab() {
  const { t } = useI18n();
  const targets = useSessionStore((s) => s.targets);
  const assets = useSessionStore((s) => s.assets);
  const nodes = useNetMapStore((s) => s.nodes);
  const selectedNodeId = useNetMapStore((s) => s.selectedNodeId);
  const selectNode = useNetMapStore((s) => s.selectNode);
  const setNetMapVisible = useAppStore((s) => s.setNetMapVisible);
  const upsertTask = usePentestTreeStore((s) => s.upsertTask);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const session = useSessionStore((s) => s.currentSession);
  const [view, setView] = useState<AssetView>('inventory');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [menu, setMenu] = useState<AssetMenuState | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  const assetNodes = useMemo(() => nodes.filter((node) => node.type !== 'local'), [nodes]);
  const visibleNodes = useMemo(() => assetNodes
    .filter((node) => typeFilter === 'all' || node.type === typeFilter)
    .filter((node) => statusFilter === 'all' || node.status === statusFilter)
    .filter((node) => {
      const needle = query.trim().toLowerCase();
      return !needle || [node.label, node.ip, node.hostname, node.key, node.type]
        .some((value) => value?.toLowerCase().includes(needle));
    }), [assetNodes, query, statusFilter, typeFilter]);

  const menuNode = menu ? nodes.find((node) => node.id === menu.nodeId) : undefined;
  const menuTarget = menuNode ? targets.find((target) => target.id === menuNode.id) : undefined;
  const menuAsset = menuNode ? assets.find((asset) => asset.id === menuNode.id) : undefined;
  const menuBrowserUrl = menuNode ? assetBrowserUrl(menuNode, menuTarget, menuAsset) : undefined;
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu || !menuNode) return [];
    return [
      {
        id: 'view-netmap',
        label: t('assets.viewInNetMap'),
        onSelect: () => {
          selectNode(menuNode.id);
          setNetMapVisible(true);
        },
      },
      ...(menuBrowserUrl ? [{
        id: 'open-browser',
        label: t('assets.openInBrowser'),
        onSelect: () => { openBrowserTab(menuBrowserUrl); },
      }] : []),
      {
        id: 'copy-address',
        label: t('assets.copyAddress'),
        separatorBefore: true,
        onSelect: () => window.hexestra.invoke('clipboard:write-text', assetPrimaryValue(menuNode, menuTarget, menuAsset)),
      },
      {
        id: 'copy-json',
        label: t('assets.copyJson'),
        onSelect: () => window.hexestra.invoke('clipboard:write-text', JSON.stringify(assetJsonPayload(menuNode, menuTarget, menuAsset), null, 2)),
      },
      {
        id: 'rescan',
        label: t('assets.rescanWithAgent'),
        separatorBefore: true,
        disabled: isProcessing || menuNode.status === 'out_of_scope',
        onSelect: async () => {
          const plan = buildAssetRescanPlan(menuNode, menuTarget, session?.scope);
          await upsertTask(plan.task);
          await sendMessage(plan.message);
        },
      },
    ];
  }, [isProcessing, menu, menuAsset, menuBrowserUrl, menuNode, menuTarget, selectNode, sendMessage, session?.scope, setNetMapVisible, t, upsertTask]);

  useEffect(() => {
    if (!filtersExpanded) return;
    const collapseOutside = (event: PointerEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersExpanded(false);
    };
    window.addEventListener('pointerdown', collapseOutside);
    return () => window.removeEventListener('pointerdown', collapseOutside);
  }, [filtersExpanded]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border-subtle bg-panel/50 p-2">
        <div className="ui-segmented mb-2 grid min-w-0 grid-cols-3 select-none">
          {(['inventory', 'changes', 'scope'] as const).map((option) => (
            <button
              key={option}
              title={t(option === 'inventory' ? 'assets.inventory' : option === 'changes' ? 'assets.changes' : 'assets.scope')}
              onClick={() => setView(option)}
              className={`ui-segmented-item min-w-0 px-1 py-1 text-center font-mono text-[11px] uppercase leading-tight tracking-wider ${view === option ? 'ui-segmented-item-active' : ''}`}
            >
              <span className="block min-w-0 truncate">
                {t(option === 'inventory' ? 'assets.inventory' : option === 'changes' ? 'assets.changes' : 'assets.scope')}
              </span>
            </button>
          ))}
        </div>
        {view === 'inventory' && <div ref={filtersRef}>
          <label className={`ui-control flex h-7 items-center gap-2 px-2 ${filtersExpanded ? '!border-accent-blue/35' : ''} hover:!bg-panel/55 select-none`}>
            <Icon name="search" size={12} />
            <input
              aria-label={t('assets.search')}
              aria-expanded={filtersExpanded}
              aria-controls="asset-inventory-filters"
              value={query}
              onFocus={() => setFiltersExpanded(true)}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('assets.searchPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-2xs text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none"
            />
            {(query || typeFilter !== 'all' || statusFilter !== 'all') && <span className="h-1.5 w-1.5 rounded-full bg-accent-blue select-none" aria-label="Filters active" />}
            <span className="font-mono text-[11px]">{visibleNodes.length}/{assetNodes.length}</span>
          </label>
          {filtersExpanded && <div id="asset-inventory-filters" className="mt-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <FilterSelect label="Filter asset type" value={typeFilter} onChange={setTypeFilter} options={['all', ...new Set(assetNodes.map((node) => node.type))]} />
              <FilterSelect label="Filter asset status" value={statusFilter} onChange={setStatusFilter} options={['all', 'untested', 'in_progress', 'scanned', 'vulnerable', 'compromised', 'out_of_scope']} />
            </div>
          </div>}
        </div>}
      </div>

      {view === 'inventory' && <>
        <div className="flex-1 overflow-y-auto">
          {visibleNodes.length === 0 ? <EmptyAssets hasAny={assetNodes.length > 0} /> : visibleNodes.map((node) => {
            const target = targets.find((candidate) => candidate.id === node.id);
            const asset = assets.find((candidate) => candidate.id === node.id);
            const updatedAt = target?.lastUpdated ?? asset?.lastUpdated;
            return <button
              key={node.id}
              onClick={() => selectNode(node.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ nodeId: node.id, x: event.clientX, y: event.clientY, target: event.currentTarget });
              }}
              className={`ui-hover-row mx-1.5 my-0.5 w-[calc(100%-0.75rem)] px-2.5 py-2 text-left ${selectedNodeId === node.id ? '!border-accent-blue/30 !bg-accent-blue/10 shadow-sm shadow-black/10' : ''}`}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5 select-none"><span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-text-primary">{node.label}</span><StatusBadge status={node.status} className="shrink-0" /></div>
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted select-none"><span className="shrink-0 uppercase text-accent-teal select-none">{node.type}</span><span className="min-w-0 flex-1 truncate">{assetPrimaryValue(node, target, asset)}</span>{node.portCount > 0 && <span className="shrink-0">{node.portCount} ports</span>}</div>
              {updatedAt && <div className="mt-1 font-mono text-[11px] text-text-muted/70 select-none">Seen {formatTime(updatedAt)}</div>}
            </button>;
          })}
        </div>
      </>}
      {view === 'changes' && <ChangesPanel />}
      {view === 'scope' && <ScopePanel />}
      <ContextMenu
        open={!!menu && !!menuNode}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        returnFocus={menu?.target}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="ui-control h-7 min-w-0 px-1 text-[11px] uppercase text-text-secondary">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function EmptyAssets({ hasAny }: { hasAny: boolean }) {
  const { t } = useI18n();
  return <div className="flex h-full flex-col items-center justify-center p-4 text-text-muted"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle bg-panel"><Icon name="target" size={22} /></div><p className="mb-1 text-center text-xs font-medium text-text-secondary">{hasAny ? t('assets.noMatching') : t('assets.none')}</p><p className="text-center text-2xs">{hasAny ? t('assets.changeFilters') : t('assets.emptyHint')}</p></div>;
}

function ChangesPanel() {
  const changes = useSessionStore((s) => s.assetChanges);
  const runs = useSessionStore((s) => s.scanRuns);
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="border-b border-border-subtle/60 px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted">{runs.length} scan runs · {changes.length} changes</div>
    {runs.length > 0 && <div className="border-b border-border-subtle/60 bg-panel/20 px-3 py-2"><div className="mb-1 text-[11px] uppercase tracking-wider text-text-muted">Recent scans</div>{runs.slice(0, 6).map((run) => <div key={run.id} className="flex min-w-0 items-center justify-between gap-2 py-0.5 font-mono text-[11px]"><span className="min-w-0 truncate uppercase text-text-secondary">{run.tool}</span><span className="shrink-0 text-text-muted">{run.changeCount} changes · {formatTime(run.completedAt)}</span></div>)}</div>}
    {changes.length === 0 ? <div className="p-4 text-center text-2xs text-text-muted">No material changes observed yet.</div> : changes.map((change) => <div key={change.id} className="border-b border-border-subtle/50 px-3 py-2">
      <div className="mb-1 flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${change.kind === 'endpoint_changed' ? 'bg-severity-medium' : 'bg-accent-green'}`} /><span className="font-mono text-[11px] uppercase text-accent-teal">{change.kind.replaceAll('_', ' ')}</span></div>
      <div className="text-2xs leading-relaxed text-text-primary">{change.label}</div>
      {(change.before || change.after) && <div className="mt-1 truncate font-mono text-[11px] text-text-muted">{change.before ? `${change.before} → ` : ''}{change.after}</div>}
      <div className="mt-1 font-mono text-[11px] text-text-muted/70">{formatTime(change.observedAt)}</div>
    </div>)}
  </div>;
}

function ScopePanel() {
  const { t } = useI18n();
  const session = useSessionStore((s) => s.currentSession);
  const updateScope = useSessionStore((s) => s.updateScope);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const [included, setIncluded] = useState('');
  const [excluded, setExcluded] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setIncluded(session?.scope?.inScope.join('\n') ?? ''); setExcluded(session?.scope?.outOfScope.join('\n') ?? ''); }, [session?.id, session?.scope]);
  if (!session) return null;
  const save = async () => {
    const scope: SessionScope = { inScope: lines(included), outOfScope: lines(excluded), targets: session.scope?.targets ?? [] };
    await updateScope(scope);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1_500);
  };
  const askAgent = () => sendMessage('请执行 Stage 0 的 Scope 定义：根据我在当前对话中提供的根目标、项目已有资产和已验证关系，生成最小且可解释的授权范围，并调用 scope_update 写入。根域的子域和由其直接解析出的主机可以纳入；第三方、CDN、共享托管或边界不明资产必须先通过 AskUserQuestion 向我确认。更新后调用 target_list 复核资产状态。');
  const scopeEmpty = (session.scope?.inScope.length ?? 0) === 0;
  return <div className="min-h-0 flex-1 overflow-y-auto p-3">
    {scopeEmpty && <div className="mb-3 rounded border border-accent-blue/25 bg-accent-blue/5 p-2.5"><div className="mb-1 text-2xs font-medium text-accent-blue">Scope has not been defined</div><p className="mb-2 text-[11px] leading-relaxed text-text-muted">Let the Agent derive a minimal scope from the authorized root target and verified relationships.</p><button disabled={isProcessing} onClick={() => void askAgent()} className="flex w-full items-center justify-center gap-1.5 rounded border border-accent-blue/40 bg-accent-blue/10 px-2 py-1.5 text-2xs text-accent-blue disabled:opacity-40"><Icon name="sparkles" size={11} />{isProcessing ? 'Agent is working…' : 'Define Scope with Agent'}</button></div>}
    <p className="mb-3 text-2xs leading-relaxed text-text-muted">One IP, domain, URL, or CIDR per line. Exclusions always win. Manual edits remain available.</p>
    <ScopeField label={t('assets.inScope')} value={included} onChange={setIncluded} placeholder={'example.com\n192.0.2.0/24'} />
    <ScopeField label={t('assets.outOfScope')} value={excluded} onChange={setExcluded} placeholder={'auth.example.com\n192.0.2.200'} />
    <button onClick={() => void save()} className="mt-2 w-full rounded border border-accent-blue/40 bg-accent-blue/10 px-2 py-1.5 text-2xs text-accent-blue hover:bg-accent-blue/15">{saved ? t('assets.scopeSaved') : t('assets.saveScope')}</button>
  </div>;
}

function ScopeField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="mb-3 block"><span className="mb-1 block text-2xs font-medium text-text-secondary">{label}</span><textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={5} className="w-full resize-y rounded border border-border-subtle bg-panel p-2 font-mono text-2xs text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-blue/50" /></label>;
}

function formatTime(value: string) { return new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function lines(value: string) { return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]; }
