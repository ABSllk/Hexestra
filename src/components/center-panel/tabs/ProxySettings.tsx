import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  EgressProxyChain,
  EgressProxyNodeInput,
  EgressProxyProtocol,
  EgressProxyRuntimeState,
} from '@electron/contracts/egress-proxy';
import {
  Button,
  DismissibleNotice,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  SegmentedControl,
  Surface,
  TextInput,
} from '@/components/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { useEgressProxyStore, useSessionStore } from '@/stores';
import { installEgressProxyEvents } from '@/stores/useEgressProxyStore';

type InputMode = 'uri' | 'form' | 'yaml';

const PROTOCOLS: EgressProxyProtocol[] = [
  'http', 'https', 'socks5', 'ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic',
];

const INPUT_MODES = [
  { id: 'uri', label: 'URI' },
  { id: 'form', label: 'FORM' },
  { id: 'yaml', label: 'YAML' },
];

const NODE_LIBRARY_DEFAULT_WIDTH = 304;
const NODE_LIBRARY_MIN_WIDTH = 240;
const NODE_LIBRARY_MAX_WIDTH = 480;
const NODE_LIBRARY_COLLAPSED_WIDTH = 48;
const NODE_LIBRARY_RESIZE_STEP = 16;
const CHAIN_EDITOR_MIN_WIDTH = 320;

export function ProxySettings() {
  const { language } = useI18n();
  const zh = language === 'zh-CN';
  const projectId = useSessionStore((state) => state.currentSession?.id ?? null);
  const proxy = useEgressProxyStore();
  const [mode, setMode] = useState<InputMode>('uri');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [nodeMessage, setNodeMessage] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(true);
  const [nodeLibraryWidth, setNodeLibraryWidth] = useState(NODE_LIBRARY_DEFAULT_WIDTH);
  const [nodeLibraryResizing, setNodeLibraryResizing] = useState(false);
  const nodeLibraryResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    maxWidth: number;
  } | null>(null);
  const [form, setForm] = useState({
    protocol: 'http' as EgressProxyProtocol,
    server: '',
    port: '',
    username: '',
    password: '',
  });
  const [editingChainId, setEditingChainId] = useState<string | null>(null);
  const [chainName, setChainName] = useState('');
  const [chainNodes, setChainNodes] = useState<string[]>([]);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragTargetNodeId, setDragTargetNodeId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => installEgressProxyEvents(), []);
  useEffect(() => {
    if (projectId) void proxy.load(projectId).catch(() => undefined);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeChain = proxy.chains.find((chain) => chain.id === proxy.status?.activeChainId);
  const editingChain = proxy.chains.find((chain) => chain.id === editingChainId);
  const state = proxy.status?.state ?? 'off';
  const isRuntimeOnline = state === 'ready' || state === 'degraded';
  const showsActiveChainLatency = Boolean(
    activeChain
    && editingChainId === activeChain.id
    && sameNodeOrder(chainNodes, activeChain.nodeIds),
  );
  const busy = Boolean(proxy.busy);
  const nodeCredentialLabel = credentialLabel(form.protocol, zh);
  const showPassword = protocolUsesPassword(form.protocol);
  const canSubmitNode = mode === 'form'
    ? Boolean(form.server.trim() && form.port.trim())
    : Boolean(source.trim());

  if (!projectId) {
    return (
      <EmptyState
        icon="network"
        title={zh ? '请先打开项目' : 'Open a project'}
        description={zh ? '代理配置保存在项目中。' : 'Proxy settings are stored with the project.'}
        className="h-full"
      />
    );
  }

  const submitNode = async () => {
    setNodeMessage(null);
    if (mode === 'uri') {
      const imported = await proxy.importNodes(source);
      setSource('');
      setNodeMessage(zh ? `已导入 ${imported.length} 个节点。` : `Imported ${imported.length} nodes.`);
      setImportOpen(false);
      return;
    }
    const value: EgressProxyNodeInput = mode === 'form'
      ? {
        source: 'form', name,
        value: {
          type: form.protocol === 'https' ? 'http' : form.protocol,
          server: form.server,
          port: Number(form.port),
          ...(form.protocol === 'https' ? { tls: true } : {}),
          ...(form.username && (form.protocol === 'vmess' || form.protocol === 'vless' || form.protocol === 'tuic') ? { uuid: form.username } : {}),
          ...(form.username && form.protocol === 'ss' ? { cipher: form.username } : {}),
          ...(form.username && (form.protocol === 'http' || form.protocol === 'https' || form.protocol === 'socks5') ? { username: form.username } : {}),
          ...(form.password ? { password: form.password } : {}),
          ...(form.protocol === 'vmess' ? { cipher: 'auto', alterId: 0 } : {}),
        },
      }
      : { source: 'yaml', name, value: source };
    await proxy.saveNode(value);
    setName('');
    setSource('');
    setForm((current) => ({ ...current, server: '', port: '', username: '', password: '' }));
    setNodeMessage(zh ? '节点已保存。' : 'Node saved.');
    setImportOpen(false);
  };

  const editChain = (chain?: EgressProxyChain) => {
    setEditingChainId(chain?.id ?? null);
    setChainName(chain?.name ?? '');
    setChainNodes(chain?.nodeIds ?? []);
    setDraggedNodeId(null);
    setDragTargetNodeId(null);
    setTestMessage(null);
  };

  const reorderChainNode = (nodeId: string, targetIndex: number) => {
    setChainNodes((current) => {
      const fromIndex = current.indexOf(nodeId);
      if (fromIndex < 0 || targetIndex < 0 || targetIndex >= current.length || fromIndex === targetIndex) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const startNodeLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const workspaceWidth = event.currentTarget.parentElement?.clientWidth ?? 0;
    nodeLibraryResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: nodeLibraryWidth,
      maxWidth: nodeLibraryMaxWidth(workspaceWidth),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setNodeLibraryResizing(true);
  };

  const resizeNodeLibrary = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = nodeLibraryResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setNodeLibraryWidth(clamp(
      resize.startWidth + event.clientX - resize.startX,
      NODE_LIBRARY_MIN_WIDTH,
      resize.maxWidth,
    ));
  };

  const stopNodeLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = nodeLibraryResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    nodeLibraryResizeRef.current = null;
    setNodeLibraryResizing(false);
  };

  const resizeNodeLibraryWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const maxWidth = nodeLibraryMaxWidth(event.currentTarget.parentElement?.clientWidth ?? 0);
    const nextWidth = event.key === 'ArrowLeft'
      ? nodeLibraryWidth - NODE_LIBRARY_RESIZE_STEP
      : event.key === 'ArrowRight'
        ? nodeLibraryWidth + NODE_LIBRARY_RESIZE_STEP
        : event.key === 'Home'
          ? NODE_LIBRARY_MIN_WIDTH
          : event.key === 'End'
            ? maxWidth
            : null;
    if (nextWidth === null) return;
    event.preventDefault();
    setNodeLibraryWidth(clamp(nextWidth, NODE_LIBRARY_MIN_WIDTH, maxWidth));
  };

  const saveChain = async () => {
    setTestMessage(null);
    const saved = await proxy.saveChain({ id: editingChainId ?? undefined, name: chainName, nodeIds: chainNodes });
    editChain(saved);
    setTestMessage(zh ? '链路已保存。' : 'Chain saved.');
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">{zh ? '项目代理' : 'Project Proxy'}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {proxy.busy === 'load' && <span className="text-[11px] text-text-muted">{zh ? '同步中…' : 'Syncing…'}</span>}
            <StatePill state={state} />
          </div>
        </header>

        {proxy.error && (
          <div aria-live="assertive">
            <DismissibleNotice tone="error" onDismiss={proxy.clearError}>{proxy.error}</DismissibleNotice>
          </div>
        )}

        <section aria-labelledby="proxy-runtime-title">
          <SectionHeader
            id="proxy-runtime-title"
            title={zh ? '运行时' : 'Runtime'}
          />
          <Surface className="overflow-hidden">
            <div className="grid gap-4 p-4">
              <div className="min-w-0 space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatePill state={state} />
                    <span className="text-xs font-medium text-text-secondary">
                      {activeChain?.name ?? proxy.status?.activeChainName ?? (zh ? '未激活链路' : 'No active chain')}
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-text-muted" title={proxy.diagnostic?.configuredPath ?? undefined}>
                    {proxy.diagnostic?.configuredPath ?? (zh ? '未选择 Mihomo' : 'No Mihomo selected')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric label={zh ? '版本' : 'Version'} value={proxy.diagnostic?.version ? `v${proxy.diagnostic.version}` : '—'} />
                  <Metric
                    label={zh ? '链路延迟' : 'Chain latency'}
                    value={latencyText(proxy.status?.chainLatencyMs, proxy.status?.latencyCheckedAt, zh)}
                    tone={typeof proxy.status?.chainLatencyMs === 'number' ? 'success' : 'muted'}
                    mono
                  />
                  <Metric label={zh ? '出口' : 'Exit'} value={proxy.status?.exitIp ?? 'UNKNOWN'} mono />
                </div>

                {(proxy.status?.error || proxy.diagnostic?.warning) && (
                  <div aria-live="polite" className="space-y-1 border-l-2 border-status-error/60 pl-3 text-[11px] leading-4">
                    {proxy.status?.error && <p className="text-status-error">{proxy.status.error}</p>}
                    {proxy.diagnostic?.warning && <p className="text-status-warning">{proxy.diagnostic.warning}</p>}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap content-start gap-2 border-t border-border-subtle pt-4">
                <Button size="compact" leadingIcon="folder" disabled={busy} onClick={() => void proxy.chooseRuntime().catch(() => undefined)}>
                  {zh ? '选择 Mihomo' : 'Choose Mihomo'}
                </Button>
                <Button size="compact" leadingIcon="activity" disabled={busy} onClick={() => void proxy.diagnose().catch(() => undefined)}>
                  {proxy.busy === 'diagnose' ? (zh ? '诊断中…' : 'Diagnosing…') : (zh ? '诊断' : 'Diagnose')}
                </Button>
                <Button
                  size="compact"
                  tone={proxy.status?.enabled ? 'danger' : 'primary'}
                  leadingIcon="shield"
                  disabled={busy}
                  onClick={() => void proxy.setEnabled(!proxy.status?.enabled).catch(() => undefined)}
                >
                  {proxy.status?.enabled ? (zh ? '关闭代理' : 'Turn off proxy') : (zh ? '开启代理' : 'Turn on proxy')}
                </Button>
                {proxy.status?.enabled && (
                  <Button
                    size="compact"
                    leadingIcon={isRuntimeOnline ? 'pause' : 'play'}
                    disabled={busy}
                    onClick={() => void (isRuntimeOnline ? proxy.stop() : proxy.start()).catch(() => undefined)}
                  >
                    {isRuntimeOnline ? (zh ? '停止 Runtime' : 'Stop runtime') : (zh ? '启动 Runtime' : 'Start runtime')}
                  </Button>
                )}
                <Button
                  size="compact"
                  leadingIcon="target"
                  disabled={busy || !proxy.status?.mixedPort}
                  onClick={() => void proxy.refreshExit().catch(() => undefined)}
                >
                  {proxy.busy === 'refresh' ? (zh ? '刷新中…' : 'Refreshing…') : (zh ? '刷新 IP' : 'Refresh IP')}
                </Button>
              </div>
            </div>
          </Surface>
        </section>

        <section aria-labelledby="proxy-workspace-title">
          <div className="mb-2 flex items-center gap-2">
            <h2 id="proxy-workspace-title" className="text-sm font-semibold text-text-secondary">
              {zh ? '节点与链路' : 'Nodes and chains'}
            </h2>
            <span className="font-mono text-[11px] text-text-muted">{proxy.nodes.length} / {proxy.chains.length}</span>
          </div>

          <Surface className="flex h-[25rem] min-w-0 overflow-hidden">
            <aside
              id="proxy-node-library"
              data-testid="proxy-node-library"
              aria-label={zh ? '节点库' : 'Node library'}
              className={cn(
                'flex min-w-0 shrink-0 flex-col overflow-hidden bg-panel/20',
                !nodeLibraryOpen && 'border-r border-border-subtle',
              )}
              style={{ width: nodeLibraryOpen ? nodeLibraryWidth : NODE_LIBRARY_COLLAPSED_WIDTH }}
            >
              <div className={cn('flex min-h-11 items-center gap-2 border-b border-border-subtle py-2', nodeLibraryOpen ? 'px-3' : 'justify-center px-1')}>
                {nodeLibraryOpen && (
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-semibold text-text-secondary">{zh ? '节点库' : 'Node library'}</h3>
                  </div>
                )}
                {nodeLibraryOpen && (
                  <Button
                    size="compact"
                    leadingIcon="activity"
                    disabled={busy || proxy.nodes.length === 0 || !proxy.diagnostic?.supported}
                    onClick={() => void proxy.testNodes().catch(() => undefined)}
                    title={!proxy.diagnostic?.supported ? (zh ? '请先选择可用的 Mihomo Runtime' : 'Select a working Mihomo runtime first') : undefined}
                  >
                    {proxy.busy === 'node-test' ? (zh ? '测速中…' : 'Testing…') : (zh ? '测速' : 'Test')}
                  </Button>
                )}
                {nodeLibraryOpen && (
                  <Button
                    size="compact"
                    leadingIcon={importOpen ? 'close' : 'plus'}
                    aria-expanded={importOpen}
                    aria-controls="proxy-node-import-panel"
                    aria-label={importOpen ? (zh ? '收起节点导入' : 'Close node import') : (zh ? '打开节点导入' : 'Open node import')}
                    onClick={() => { setImportOpen((open) => !open); setNodeMessage(null); }}
                  >
                    {zh ? '导入' : 'Import'}
                  </Button>
                )}
                <IconButton
                  name={nodeLibraryOpen ? 'chevron-left' : 'chevron-right'}
                  label={nodeLibraryOpen
                    ? (zh ? '收起节点库' : 'Collapse node library')
                    : (zh
                      ? `展开节点库（${proxy.nodes.length} 个节点，已选 ${chainNodes.length}）`
                      : `Expand node library (${proxy.nodes.length} nodes, ${chainNodes.length} selected)`)}
                  aria-expanded={nodeLibraryOpen}
                  aria-controls="proxy-node-library-content"
                  className="h-7 min-w-7 shrink-0"
                  onClick={() => setNodeLibraryOpen((open) => !open)}
                />
              </div>

              <div id="proxy-node-library-content" className={cn('min-h-0 flex-1 flex-col', nodeLibraryOpen ? 'flex' : 'hidden')}>
              {importOpen && (
                <div id="proxy-node-import-panel" className="max-h-[20rem] shrink-0 overflow-y-auto border-b border-border-subtle bg-raised/20 p-3">
                  <SegmentedControl
                    className="mb-3 w-fit"
                    items={INPUT_MODES}
                    value={mode}
                    onChange={(value) => { setMode(value as InputMode); setNodeMessage(null); }}
                  />
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    {mode !== 'uri' && <Field id="proxy-node-name" label={zh ? '名称（可选）' : 'Name (optional)'} value={name} onChange={setName} />}
                    {mode === 'form' && (
                      <FormField label={zh ? '协议' : 'Protocol'} htmlFor="proxy-node-protocol">
                        <select
                          id="proxy-node-protocol"
                          className="ui-control h-8 w-full px-2.5 text-xs text-text-primary"
                          value={form.protocol}
                          onChange={(event) => setForm({ ...form, protocol: event.target.value as EgressProxyProtocol, username: '', password: '' })}
                        >
                          {PROTOCOLS.map((protocol) => <option key={protocol}>{protocol}</option>)}
                        </select>
                      </FormField>
                    )}

                    {mode === 'form' ? (
                      <>
                        <Field id="proxy-node-server" label={zh ? '服务器' : 'Server'} value={form.server} onChange={(server) => setForm({ ...form, server })} />
                        <Field id="proxy-node-port" label={zh ? '端口' : 'Port'} value={form.port} inputMode="numeric" onChange={(port) => setForm({ ...form, port })} />
                        {nodeCredentialLabel && <Field id="proxy-node-credential" label={nodeCredentialLabel} value={form.username} onChange={(username) => setForm({ ...form, username })} />}
                        {showPassword && <Field id="proxy-node-password" label={zh ? '密码 / 密钥' : 'Password / secret'} type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />}
                      </>
                    ) : (
                      <FormField
                        className="sm:col-span-2 xl:col-span-1"
                        label={mode === 'uri' ? (zh ? 'URI（每行一个）' : 'URIs (one per line)') : (zh ? 'Mihomo proxy YAML' : 'Mihomo proxy YAML')}
                        htmlFor="proxy-node-source"
                      >
                        <textarea
                          id="proxy-node-source"
                          className="ui-control min-h-24 w-full resize-y px-2.5 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted"
                          value={source}
                          spellCheck={false}
                          onChange={(event) => { setSource(event.target.value); setNodeMessage(null); }}
                        />
                      </FormField>
                    )}
                  </div>
                  <Button className="mt-3 w-full" tone="primary" leadingIcon="plus" disabled={busy || !canSubmitNode} onClick={() => void submitNode().catch(() => undefined)}>
                    {proxy.busy === 'node-save' || proxy.busy === 'node-import-batch'
                      ? (zh ? '正在保存…' : 'Saving…')
                      : mode === 'uri' ? (zh ? '批量导入' : 'Import nodes') : (zh ? '导入节点' : 'Import node')}
                  </Button>
                </div>
              )}

              {nodeMessage && (
                <p role="status" className="flex items-center gap-1.5 border-b border-status-success/20 bg-status-success/5 px-3 py-2 text-[11px] text-status-success">
                  <Icon name="check" size={12} />{nodeMessage}
                </p>
              )}

              {proxy.nodes.length === 0 ? (
                <EmptyState
                  icon="server"
                  title={zh ? '还没有节点' : 'No nodes yet'}
                  action={!importOpen ? <Button size="compact" leadingIcon="plus" onClick={() => setImportOpen(true)}>{zh ? '导入节点' : 'Import nodes'}</Button> : undefined}
                  className="min-h-0 flex-1"
                />
              ) : (
                <div data-testid="proxy-node-library-scroll" className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto overscroll-contain">
                  {proxy.nodes.map((node) => {
                    const selected = chainNodes.includes(node.id);
                    const limitReached = chainNodes.length >= 8;
                    return (
                      <div key={node.id} className={cn('group flex min-w-0 items-center transition-colors', selected ? 'bg-accent-blue/10' : 'hover:bg-raised/40')}>
                        <button
                          type="button"
                          aria-label={selected
                            ? `${zh ? '已在链路中' : 'Already in chain'}: ${node.name}`
                            : `${zh ? '添加节点到链路' : 'Add node to chain'}: ${node.name}`}
                          aria-pressed={selected}
                          disabled={busy || selected || limitReached}
                          onClick={() => setChainNodes((current) => current.includes(node.id) || current.length >= 8 ? current : [...current, node.id])}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/50 disabled:cursor-default"
                        >
                          <Icon name={selected ? 'check' : 'server'} size={13} className={selected ? 'text-accent-blue' : 'text-text-muted'} />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-text-secondary" title={node.name}>{node.name}</span>
                              <span className="shrink-0 font-mono text-[10px] uppercase text-text-muted">{node.protocol}</span>
                            </span>
                            <LatencyBadge
                              latencyMs={Object.prototype.hasOwnProperty.call(proxy.nodeTestResult?.nodeLatencyMs ?? {}, node.id)
                                ? proxy.nodeTestResult?.nodeLatencyMs[node.id] ?? null
                                : undefined}
                              checkedAt={Object.prototype.hasOwnProperty.call(proxy.nodeTestResult?.nodeLatencyMs ?? {}, node.id)
                                ? proxy.nodeTestResult?.checkedAt ?? null
                                : null}
                              zh={zh}
                            />
                          </span>
                          <Icon name={selected ? 'check' : 'plus'} size={12} className={selected ? 'text-accent-blue' : limitReached ? 'text-status-warning' : 'text-text-muted'} />
                        </button>
                        <IconButton
                          name="trash"
                          label={`${zh ? '删除节点' : 'Delete node'}: ${node.name}`}
                          className="mr-1 h-7 min-w-7 border-transparent opacity-60 hover:bg-status-error/10 hover:text-status-error group-hover:opacity-100 focus-visible:opacity-100"
                          disabled={busy || selected}
                          onClick={() => void proxy.deleteNode(node.id).catch(() => undefined)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              </div>

              {!nodeLibraryOpen && (
                <div className="flex min-h-0 flex-1 flex-col items-center gap-2 py-3 text-text-muted" aria-hidden="true">
                  <Icon name="server" size={15} />
                  <span className="font-mono text-[10px]">{proxy.nodes.length}</span>
                  <span className="h-px w-4 bg-border-subtle" />
                  <Icon name="check" size={13} />
                  <span className="font-mono text-[10px]">{chainNodes.length}</span>
                </div>
              )}
            </aside>

            {nodeLibraryOpen && (
              <div
                data-testid="proxy-node-library-resizer"
                role="separator"
                aria-label={zh ? '调整节点库宽度' : 'Resize node library'}
                aria-orientation="vertical"
                aria-valuemin={NODE_LIBRARY_MIN_WIDTH}
                aria-valuemax={NODE_LIBRARY_MAX_WIDTH}
                aria-valuenow={nodeLibraryWidth}
                tabIndex={0}
                onPointerDown={startNodeLibraryResize}
                onPointerMove={resizeNodeLibrary}
                onPointerUp={stopNodeLibraryResize}
                onPointerCancel={stopNodeLibraryResize}
                onKeyDown={resizeNodeLibraryWithKeyboard}
                className={cn(
                  'group relative w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/60',
                  nodeLibraryResizing && 'bg-accent-blue/5',
                )}
              >
                <span className={cn(
                  'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-subtle group-hover:bg-accent-blue/60 group-focus-visible:bg-accent-blue',
                  nodeLibraryResizing && 'bg-accent-blue',
                )} />
              </div>
            )}

            <div data-testid="proxy-chain-editor" className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="text-xs font-semibold text-text-secondary">{zh ? '多跳链' : 'Multi-hop chains'}</h3>
                  <span className="font-mono text-[11px] text-text-muted">{proxy.chains.length}</span>
                </div>
                <div className="min-w-40 flex-1 sm:max-w-64">
                  <select
                    aria-label={zh ? '选择代理链' : 'Select proxy chain'}
                    className="ui-control h-7 w-full px-2 text-[11px] text-text-secondary"
                    value={editingChainId ?? ''}
                    onChange={(event) => {
                      const chain = proxy.chains.find((item) => item.id === event.target.value);
                      editChain(chain);
                    }}
                  >
                    <option value="">{zh ? '新链' : 'New chain'}</option>
                    {proxy.chains.map((chain) => (
                      <option key={chain.id} value={chain.id}>{chain.name} · {chain.nodeIds.length} HOPS</option>
                    ))}
                  </select>
                </div>
                {editingChain && proxy.status?.activeChainId === editingChain.id && (
                  <span className="flex items-center gap-1 text-[11px] text-status-success"><Icon name="circle" size={8} />{zh ? '活动' : 'Active'}</span>
                )}
                <Button size="compact" leadingIcon="plus" onClick={() => editChain()}>{zh ? '新建' : 'New'}</Button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                <div className="grid shrink-0 items-end gap-3 sm:grid-cols-[minmax(180px,1fr)_auto]">
                  <Field id="proxy-chain-name" label={zh ? '链名称' : 'Chain name'} value={chainName} onChange={setChainName} />
                  <div className="flex h-8 items-center gap-3 text-[11px] text-text-muted">
                    <span className="font-mono">{chainNodes.length}/8 HOPS</span>
                    {showsActiveChainLatency && (
                      <LatencyBadge latencyMs={proxy.status?.chainLatencyMs} checkedAt={proxy.status?.latencyCheckedAt ?? null} zh={zh} />
                    )}
                  </div>
                </div>

                <div className="my-3 flex min-h-0 flex-1 items-center overflow-x-auto rounded-md border border-border-subtle bg-panel/35 p-3" aria-label={zh ? '代理链流量顺序' : 'Proxy chain traffic order'}>
                  <div className="flex min-w-max items-center gap-1.5">
                    <FlowNode label="Hexestra" detail="SOURCE" accent />
                    {chainNodes.map((nodeId, index) => {
                      const node = proxy.nodes.find((item) => item.id === nodeId);
                      return (
                        <div key={nodeId} className="flex items-center gap-1.5">
                          <Icon name="chevron-right" size={12} className="text-text-muted" />
                          <FlowNode
                            label={node?.name ?? (zh ? '缺失节点' : 'Missing node')}
                            detail={index === chainNodes.length - 1 ? 'EXIT' : `HOP ${index + 1}`}
                            latencyMs={showsActiveChainLatency && Object.prototype.hasOwnProperty.call(proxy.status?.nodeLatencyMs ?? {}, nodeId)
                              ? proxy.status?.nodeLatencyMs[nodeId] ?? null
                              : undefined}
                            latencyCheckedAt={showsActiveChainLatency ? proxy.status?.latencyCheckedAt ?? null : null}
                            zh={zh}
                            canReorder
                            dragging={draggedNodeId === nodeId}
                            dropTarget={dragTargetNodeId === nodeId && draggedNodeId !== nodeId}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', nodeId);
                              setDraggedNodeId(nodeId);
                            }}
                            onDragOver={(event) => {
                              if (!draggedNodeId || draggedNodeId === nodeId) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setDragTargetNodeId(nodeId);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const dragged = draggedNodeId ?? event.dataTransfer.getData('text/plain');
                              if (dragged) reorderChainNode(dragged, index);
                              setDraggedNodeId(null);
                              setDragTargetNodeId(null);
                            }}
                            onDragEnd={() => {
                              setDraggedNodeId(null);
                              setDragTargetNodeId(null);
                            }}
                            onMoveEarlier={index > 0 ? () => reorderChainNode(nodeId, index - 1) : undefined}
                            onMoveLater={index < chainNodes.length - 1 ? () => reorderChainNode(nodeId, index + 1) : undefined}
                            moveEarlierLabel={`${zh ? '前移节点' : 'Move node earlier'}: ${node?.name ?? nodeId}`}
                            moveLaterLabel={`${zh ? '后移节点' : 'Move node later'}: ${node?.name ?? nodeId}`}
                            onRemove={() => setChainNodes((current) => current.filter((id) => id !== nodeId))}
                            removeLabel={`${zh ? '移除节点' : 'Remove node'}: ${node?.name ?? nodeId}`}
                          />
                        </div>
                      );
                    })}
                    <Icon name="chevron-right" size={12} className="text-text-muted" />
                    <FlowNode label="Target" detail="DESTINATION" />
                  </div>
                </div>

                <div className="mt-auto flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                  <Button size="compact" tone="primary" leadingIcon="check" disabled={busy || chainNodes.length === 0} onClick={() => void saveChain().catch(() => undefined)}>
                    {proxy.busy === 'chain-save' ? (zh ? '校验中…' : 'Validating…') : (zh ? '保存' : 'Save')}
                  </Button>
                  {editingChainId && (
                    <>
                      <Button size="compact" tone="trust" leadingIcon="play" disabled={busy} onClick={() => void proxy.activateChain(editingChainId).catch(() => undefined)}>{zh ? '激活' : 'Activate'}</Button>
                      <Button size="compact" leadingIcon="activity" disabled={busy} onClick={() => void proxy.testChain(editingChainId).then((result) => setTestMessage(result.error ?? `${zh ? '链路总延迟' : 'Total chain latency'}: ${latencyText(result.latencyMs, new Date().toISOString(), zh)}`)).catch(() => undefined)}>
                        {proxy.busy === 'chain-test' ? (zh ? '测试中…' : 'Testing…') : (zh ? '测试' : 'Test chain')}
                      </Button>
                      <Button size="compact" tone="danger" leadingIcon="trash" disabled={busy} onClick={() => void proxy.deleteChain(editingChainId).then(() => editChain()).catch(() => undefined)}>{zh ? '删除' : 'Delete'}</Button>
                    </>
                  )}
                  {testMessage && <p role="status" className="basis-full text-[11px] leading-4 text-text-muted">{testMessage}</p>}
                </div>
              </div>
            </div>
          </Surface>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ id, title, description, count }: { id: string; title: string; description?: string; count?: number }) {
  return (
    <div className="mb-3 min-w-0">
      <div className="flex items-center gap-2">
        <h2 id={id} className="text-sm font-semibold text-text-secondary">{title}</h2>
        {count !== undefined && <span className="rounded border border-border-subtle bg-raised/55 px-1.5 py-0.5 font-mono text-[11px] text-text-muted">{count}</span>}
      </div>
      {description && <p className="mt-0.5 max-w-4xl text-[11px] leading-4 text-text-muted">{description}</p>}
    </div>
  );
}

function Field({ id, label, value, onChange, className, type = 'text', inputMode }: { id: string; label: string; value: string; onChange: (value: string) => void; className?: string; type?: string; inputMode?: 'numeric' }) {
  return (
    <FormField className={className} label={label} htmlFor={id}>
      <TextInput id={id} type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} />
    </FormField>
  );
}

function Metric({ label, value, tone = 'default', mono = false }: { label: string; value: string; tone?: 'default' | 'success' | 'muted'; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-panel/45 px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={cn(
        'mt-1 truncate text-xs font-semibold',
        mono && 'font-mono font-medium',
        tone === 'success' ? 'text-status-success' : tone === 'muted' ? 'text-text-muted' : 'text-text-secondary',
      )} title={value}>{value}</div>
    </div>
  );
}

function LatencyBadge({ latencyMs, checkedAt, zh }: { latencyMs: number | null | undefined; checkedAt: string | null; zh: boolean }) {
  const reachable = typeof latencyMs === 'number';
  const checked = Boolean(checkedAt);
  const label = latencyText(latencyMs, checkedAt, zh);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px]',
        reachable ? 'text-status-success' : checked ? 'text-status-error' : 'text-text-muted',
      )}
      title={checkedAt ? `${zh ? '检测时间' : 'Checked'}: ${new Date(checkedAt).toLocaleString()}` : undefined}
    >
      <Icon name={reachable ? 'activity' : checked ? 'close' : 'circle'} size={11} />{label}
    </span>
  );
}

function latencyText(latencyMs: number | null | undefined, checkedAt: string | null | undefined, zh: boolean) {
  if (typeof latencyMs === 'number') return `${latencyMs} ms`;
  if (checkedAt) return zh ? '超时' : 'TIMEOUT';
  return zh ? '未知' : 'UNKNOWN';
}

function StatePill({ state }: { state: EgressProxyRuntimeState }) {
  const tone = state === 'ready'
    ? 'border-status-success/30 bg-status-success/10 text-status-success'
    : state === 'degraded' || state === 'starting'
      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
      : state === 'off'
        ? 'border-border-subtle bg-raised/40 text-text-muted'
        : 'border-status-error/30 bg-status-error/10 text-status-error';
  return (
    <span className={cn('inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] font-semibold', tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {state.toUpperCase()}
    </span>
  );
}

function FlowNode({
  label, detail, accent, latencyMs, latencyCheckedAt, zh = false,
  canReorder = false, dragging = false, dropTarget = false,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onMoveEarlier, onMoveLater, moveEarlierLabel, moveLaterLabel,
  onRemove, removeLabel,
}: {
  label: string;
  detail: string;
  accent?: boolean;
  latencyMs?: number | null;
  latencyCheckedAt?: string | null;
  zh?: boolean;
  canReorder?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  moveEarlierLabel?: string;
  moveLaterLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <div
      draggable={canReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
      'group/flow flex min-h-10 items-center gap-1.5 rounded-md border px-2 py-1.5 transition-[border-color,box-shadow,opacity]',
      accent ? 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal' : 'border-border-subtle bg-raised/60 text-text-secondary',
      canReorder && 'cursor-grab active:cursor-grabbing',
      dragging && 'opacity-45',
      dropTarget && 'border-accent-blue/70 ring-1 ring-accent-blue/45',
    )}
    >
      {canReorder && <Icon name="grip" size={12} className="text-text-muted" />}
      <div className="min-w-0">
        <div className="max-w-28 truncate text-[11px] font-medium">{label}</div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-text-muted">{detail}</span>
          {latencyCheckedAt && <LatencyBadge latencyMs={latencyMs} checkedAt={latencyCheckedAt} zh={zh} />}
        </div>
      </div>
      {canReorder && (
        <div className="flex items-center gap-0.5">
          <IconButton
            name="chevron-left"
            label={moveEarlierLabel ?? 'Move hop earlier'}
            size={10}
            className="h-6 min-w-6"
            disabled={!onMoveEarlier}
            onClick={onMoveEarlier}
          />
          <IconButton
            name="chevron-right"
            label={moveLaterLabel ?? 'Move hop later'}
            size={10}
            className="h-6 min-w-6"
            disabled={!onMoveLater}
            onClick={onMoveLater}
          />
        </div>
      )}
      {onRemove && <IconButton name="close" label={removeLabel ?? 'Remove hop'} size={11} className="h-6 min-w-6 hover:text-status-error" onClick={onRemove} />}
    </div>
  );
}

function nodeLibraryMaxWidth(workspaceWidth: number) {
  if (workspaceWidth <= 0) return NODE_LIBRARY_MAX_WIDTH;
  return Math.max(
    NODE_LIBRARY_MIN_WIDTH,
    Math.min(NODE_LIBRARY_MAX_WIDTH, workspaceWidth - CHAIN_EDITOR_MIN_WIDTH),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sameNodeOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((nodeId, index) => nodeId === right[index]);
}

function credentialLabel(protocol: EgressProxyProtocol, zh: boolean) {
  if (protocol === 'ss') return zh ? '加密方式（cipher）' : 'Cipher';
  if (protocol === 'vmess' || protocol === 'vless' || protocol === 'tuic') return 'UUID';
  if (protocol === 'http' || protocol === 'https' || protocol === 'socks5') return zh ? '用户名（可选）' : 'Username (optional)';
  return null;
}

function protocolUsesPassword(protocol: EgressProxyProtocol) {
  return protocol !== 'vmess' && protocol !== 'vless';
}
