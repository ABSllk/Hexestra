import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Icon } from '@/components/shared';
import { buildDomainProjection } from '@/lib/networkGraph';
import { APP_FONT_SIZE_PX, APP_SUPPORTING_FONT_SIZE_PX } from '@/lib/typography';
import { getNetMapPalette, type NetMapPalette } from '@/lib/theme';
import { useAppPreferences } from '@/i18n';
import {
  layoutDomain,
  netmapLayoutFingerprint,
  netmapNodeCoreSize,
  netmapNodeScale,
  NETMAP_SCANLINE_NODE_LIMIT,
  NETMAP_PREVIEW,
  resolveNodeOverlaps,
} from '@/lib/netmapLayout';
import { useAppStore, useNetMapStore, useSessionStore } from '@/stores';
import type { GraphEdge, GraphNode, GraphViewTransform } from '@/types';
import { NetMapAssetDetails } from './NetMapAssetDetails';

const NETMAP_EDGE_LABEL_FONT_SIZE = 7;
const NETMAP_EDGE_LABEL_HEIGHT = 13;

interface Point {
  x: number;
  y: number;
}

interface NodeDragState {
  nodeId: string;
  grabOffset: Point;
  startClient: Point;
  moved: boolean;
}

let automaticLayoutCache: {
  key: string;
  layout: ReturnType<typeof layoutDomain>;
} | null = null;

function cachedAutomaticLayout(
  key: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  viewport: { width: number; height: number },
) {
  if (automaticLayoutCache?.key === key) return automaticLayoutCache.layout;
  const layout = layoutDomain(nodes, edges, viewport);
  automaticLayoutCache = { key, layout };
  return layout;
}

export function NetMapView() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<Point | null>(null);
  const transformOriginRef = useRef<Point>({ x: 0, y: 0 });
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const suppressedClickRef = useRef<{ nodeId: string } | null>(null);
  const hydratedLayoutRef = useRef(new Set<string>());
  const layoutInteractionRef = useRef(0);
  const [viewport, setViewport] = useState({ width: 960, height: 320 });
  const [previewSelection, setPreviewSelection] = useState<string | null>('preview-web');
  const [isDragging, setIsDragging] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const nodes = useNetMapStore((state) => state.nodes);
  const edges = useNetMapStore((state) => state.edges);
  const selectedNodeId = useNetMapStore((state) => state.selectedNodeId);
  const highlightedNodeIds = useNetMapStore((state) => state.highlightedNodeIds);
  const selectNode = useNetMapStore((state) => state.selectNode);
  const view = useNetMapStore((state) => state.view);
  const manualPositions = useNetMapStore((state) => state.positions);
  const hydrateLayout = useNetMapStore((state) => state.hydrateLayout);
  const setViewTransform = useNetMapStore((state) => state.setViewTransform);
  const setManualPosition = useNetMapStore((state) => state.setManualPosition);
  const resetLayout = useNetMapStore((state) => state.resetLayout);
  const sessionId = useSessionStore((state) => state.currentSession?.id);
  const toggleNetMap = useAppStore((state) => state.toggleNetMap);
  const { resolvedTheme } = useAppPreferences();
  const palette = getNetMapPalette(resolvedTheme);

  const isPreview = nodes.length === 0;
  const canonicalNodes = isPreview ? NETMAP_PREVIEW.nodes : nodes;
  const canonicalEdges = isPreview ? NETMAP_PREVIEW.edges : edges;
  const projection = useMemo(
    () => buildDomainProjection(canonicalNodes, canonicalEdges),
    [canonicalEdges, canonicalNodes],
  );
  const renderedNodes = projection.nodes;
  const renderedEdges = projection.edges;
  const layoutFingerprint = useMemo(
    () => netmapLayoutFingerprint(renderedNodes, renderedEdges),
    [renderedEdges, renderedNodes],
  );
  const automaticLayoutKey = useMemo(
    () => `${viewport.width}x${viewport.height}:${layoutFingerprint}`,
    [layoutFingerprint, viewport.height, viewport.width],
  );
  const denseGraph = renderedNodes.length > 36;
  const visualNodeScale = netmapNodeScale(renderedNodes.length, viewport);
  const requestedActiveNodeId = isPreview ? previewSelection : selectedNodeId;
  const activeNodeId = renderedNodes.some((node) => node.id === requestedActiveNodeId)
    ? requestedActiveNodeId
    : null;
  const relationshipFocusId = hoveredNodeId ?? activeNodeId;
  const relationshipNodeIds = useMemo(() => {
    if (!relationshipFocusId) return new Set<string>();
    const related = new Set([relationshipFocusId]);
    for (const edge of renderedEdges) {
      if (edge.source === relationshipFocusId) related.add(edge.target);
      if (edge.target === relationshipFocusId) related.add(edge.source);
    }
    return related;
  }, [relationshipFocusId, renderedEdges]);
  // The fingerprint contains every field that influences geometry. New IPC
  // arrays and React StrictMode's repeated render can therefore reuse it.
  const automaticLayout = useMemo(
    () => cachedAutomaticLayout(
      automaticLayoutKey,
      renderedNodes,
      renderedEdges,
      viewport,
    ),
    [automaticLayoutKey],
  );
  const automaticPositionById = useMemo(
    () => new Map(automaticLayout.map((node) => [node.id, node])),
    [automaticLayout],
  );
  const hasManualPositions = useMemo(
    () => automaticLayout.some((node) => Boolean(manualPositions[node.id])),
    [automaticLayout, manualPositions],
  );
  const overlapSafeLayout = useMemo(
    () => hasManualPositions
      ? resolveNodeOverlaps(
          automaticLayout.map((node) => {
            const manual = manualPositions[node.id];
            return manual ? { ...node, ...clampNodePosition(manual, viewport) } : node;
          }),
          viewport,
        )
      : automaticLayout,
    [automaticLayout, hasManualPositions, manualPositions, viewport.height, viewport.width],
  );
  const displayPositionById = useMemo(
    () => new Map(overlapSafeLayout.map((node) => [node.id, node])),
    [overlapSafeLayout],
  );
  const displayedNodes = useMemo(
    () => renderedNodes.map((node) => {
      const position = displayPositionById.get(node.id) ?? automaticPositionById.get(node.id);
      return {
        ...node,
        x: position?.x ?? viewport.width / 2,
        y: position?.y ?? viewport.height / 2,
        depth: position?.depth ?? 0,
      };
    }),
    [automaticPositionById, displayPositionById, renderedNodes, viewport.height, viewport.width],
  );
  const positionById = useMemo(
    () => new Map(displayedNodes.map((node) => [node.id, node])),
    [displayedNodes],
  );

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const measure = () => {
      const bounds = element.getBoundingClientRect();
      updateViewport(bounds.width, bounds.height);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      updateViewport(entry.contentRect.width, entry.contentRect.height);
    });
    measure();
    observer.observe(element);
    return () => observer.disconnect();

    function updateViewport(width: number, height: number) {
      const nextWidth = Math.max(Math.round(width), 480);
      const nextHeight = Math.max(Math.round(height), 160);
      setViewport((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ));
    }
  }, []);

  useEffect(() => {
    if (!window.hexestra || !sessionId) return;
    const key = sessionId;
    const interactionRevision = layoutInteractionRef.current;
    let cancelled = false;
    void window.hexestra.invoke<import('@/types').GraphLayoutState>('netmap:layout:get', sessionId)
      .then((state) => {
        if (cancelled) return;
        if (interactionRevision === layoutInteractionRef.current) {
          hydrateLayout(state);
        } else {
          const current = useNetMapStore.getState();
          void window.hexestra.invoke('netmap:layout:update', sessionId, {
            view: current.view,
            positions: current.positions,
          });
        }
        hydratedLayoutRef.current.add(key);
      })
      .catch((error) => console.error('[NetMap] Failed to load layout:', error));
    return () => { cancelled = true; };
  }, [hydrateLayout, sessionId]);

  useEffect(() => {
    if (!window.hexestra || !sessionId) return;
    const key = sessionId;
    if (!hydratedLayoutRef.current.has(key)) return;
    const timeout = window.setTimeout(() => {
      void window.hexestra.invoke(
        'netmap:layout:update',
        sessionId,
        { view, positions: manualPositions },
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [manualPositions, sessionId, view]);

  const resetView = useCallback(() => {
    layoutInteractionRef.current += 1;
    resetLayout();
  }, [resetLayout]);
  const zoomBy = useCallback((factor: number) => {
    layoutInteractionRef.current += 1;
    setViewTransform({ ...view, scale: clamp(view.scale * factor, 0.55, 2.4) });
  }, [setViewTransform, view]);

  const handleWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    layoutInteractionRef.current += 1;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setViewTransform({ ...view, scale: clamp(view.scale * factor, 0.55, 2.4) });
  }, [setViewTransform, view]);

  const handlePointerDown = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      dragOriginRef.current = { x: event.clientX, y: event.clientY };
      transformOriginRef.current = { x: view.x, y: view.y };
      setIsDragging(true);
    },
    [view.x, view.y],
  );

  const handlePointerMove = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag) {
      const automaticPosition = automaticPositionById.get(nodeDrag.nodeId);
      if (!automaticPosition) return;

      const pointer = toGraphPoint(event.clientX, event.clientY, event.currentTarget, view);
      const desiredPosition = clampNodePosition(
        {
          x: pointer.x - nodeDrag.grabOffset.x,
          y: pointer.y - nodeDrag.grabOffset.y,
        },
        viewport,
      );
      nodeDrag.moved = nodeDrag.moved
        || Math.hypot(
          event.clientX - nodeDrag.startClient.x,
          event.clientY - nodeDrag.startClient.y,
        ) >= 4;
      setManualPosition(nodeDrag.nodeId, desiredPosition);
      layoutInteractionRef.current += 1;
      return;
    }

    const origin = dragOriginRef.current;
    if (!origin) return;
    layoutInteractionRef.current += 1;
    setViewTransform({
      ...view,
      x: transformOriginRef.current.x + event.clientX - origin.x,
      y: transformOriginRef.current.y + event.clientY - origin.y,
    });
  }, [automaticPositionById, setManualPosition, setViewTransform, view, viewport]);

  const stopDragging = useCallback(() => {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag?.moved) {
      const suppression = { nodeId: nodeDrag.nodeId };
      suppressedClickRef.current = suppression;
      window.setTimeout(() => {
        if (suppressedClickRef.current === suppression) suppressedClickRef.current = null;
      }, 0);
    }
    nodeDragRef.current = null;
    dragOriginRef.current = null;
    setDraggingNodeId(null);
    setIsDragging(false);
  }, []);

  const handleNodeDragStart = useCallback(
    (node: GraphNode & Point, event: ReactMouseEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      const pointer = toGraphPoint(event.clientX, event.clientY, svg, view);
      nodeDragRef.current = {
        nodeId: node.id,
        grabOffset: { x: pointer.x - node.x, y: pointer.y - node.y },
        startClient: { x: event.clientX, y: event.clientY },
        moved: false,
      };
      setDraggingNodeId(node.id);
    },
    [view],
  );

  const handleSelect = useCallback(
    (nodeId: string) => {
      const suppressed = suppressedClickRef.current;
      suppressedClickRef.current = null;
      if (suppressed?.nodeId === nodeId) return;
      if (isPreview) setPreviewSelection(nodeId);
      else selectNode(nodeId);
    },
    [isPreview, selectNode],
  );

  const selectedProjectNode = !isPreview
    ? nodes.find((node) => node.id === selectedNodeId)
    : undefined;

  return (
    <section className="netmap-shell flex h-full flex-col" aria-label="Domain asset relationship map">
      <header className="flex shrink-0 items-center justify-between border-b border-accent-teal/10 bg-[rgb(var(--color-netmap-chrome)/0.95)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Icon name="network" size={14} className="text-accent-teal" />
          <span className="font-mono text-xs font-semibold tracking-[0.16em] text-text-secondary select-none">
            NETMAP
          </span>
          <span className="font-mono text-[11px] text-text-muted select-none">
            {renderedNodes.length} NODES / {renderedEdges.length} LINKS
          </span>
          {isPreview && (
            <span className="rounded-md border border-accent-teal/20 bg-accent-teal/5 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-accent-teal/70 select-none">
              PREVIEW TOPOLOGY
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 select-none">
          <MapControl label="Zoom out" icon="zoom-out" onClick={() => zoomBy(0.86)} />
          <span className="min-w-10 text-center font-mono text-[11px] text-text-muted">
            {Math.round(view.scale * 100)}%
          </span>
          <MapControl label="Zoom in" icon="zoom-in" onClick={() => zoomBy(1.16)} />
          <MapControl label="Fit topology" icon="fit" onClick={resetView} />
          <MapControl label="Hide NetMap" icon="close" onClick={toggleNetMap} />
        </div>
      </header>

      <div ref={canvasRef} className="netmap-canvas relative min-h-0 flex-1 overflow-hidden">
        <div className="netmap-grid absolute inset-0" />
        {renderedNodes.length <= NETMAP_SCANLINE_NODE_LIMIT && (
          <div className="netmap-scanline absolute inset-x-0 top-0 h-px" />
        )}
        <svg
          className={`absolute inset-0 h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handlePointerDown}
          onMouseLeave={stopDragging}
          onMouseMove={handlePointerMove}
          onMouseUp={stopDragging}
          onWheel={handleWheel}
          role="img"
          aria-label="Interactive domain asset graph"
        >
          <defs>
            <filter id="netmap-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="netmap-soft-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="netmap-link-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={palette.edgeBase} stopOpacity=".45" />
              <stop offset=".5" stopColor={palette.edgeLink} stopOpacity=".9" />
              <stop offset="1" stopColor={palette.edgeBase} stopOpacity=".45" />
            </linearGradient>
          </defs>

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g aria-label="Asset links">
              {renderedEdges.map((edge) => (
                <AssetEdge
                  key={edge.id}
                  edge={edge}
                  source={positionById.get(edge.source)}
                  target={positionById.get(edge.target)}
                  dense={denseGraph}
                  palette={palette}
                  focused={Boolean(relationshipFocusId) && (
                    edge.source === relationshipFocusId || edge.target === relationshipFocusId
                  )}
                  dimmed={Boolean(relationshipFocusId) && edge.source !== relationshipFocusId && edge.target !== relationshipFocusId}
                />
              ))}
            </g>
            <g aria-label="Asset nodes">
              {displayedNodes.map((node) => (
                <AssetNode
                  key={node.id}
                  node={node}
                  dragging={node.id === draggingNodeId}
                  dense={denseGraph}
                  visualScale={visualNodeScale}
                  selected={node.id === activeNodeId}
                  highlighted={!isPreview && highlightedNodeIds.includes(node.id)}
                  palette={palette}
                  related={relationshipNodeIds.has(node.id)}
                  dimmed={Boolean(relationshipFocusId) && !relationshipNodeIds.has(node.id)}
                  onDragStart={handleNodeDragStart}
                  onHover={setHoveredNodeId}
                  onSelect={handleSelect}
                />
              ))}
            </g>
          </g>
        </svg>

        {selectedProjectNode && (
          <div className="pointer-events-none absolute inset-y-3 left-3 z-10 flex max-w-[calc(100%-24px)] items-start">
            <NetMapAssetDetails nodeId={selectedProjectNode.id} onClose={() => selectNode(null)} />
          </div>
        )}

      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-accent-teal/10 bg-[rgb(var(--color-netmap-chrome)/0.95)] px-3 py-1 font-mono text-[11px] text-text-muted select-none">
        {Object.entries(palette.nodeColors).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rotate-45 border"
              style={{ borderColor: color, boxShadow: `0 0 6px ${color}` }}
            />
            <span className="uppercase tracking-wider">{status.replace('_', ' ')}</span>
          </div>
        ))}
      </footer>
    </section>
  );
}

const AssetEdge = memo(function AssetEdge({
  edge,
  source,
  target,
  dense,
  palette,
  focused,
  dimmed,
}: {
  edge: GraphEdge;
  source?: Point;
  target?: Point;
  dense: boolean;
  palette: NetMapPalette;
  focused: boolean;
  dimmed: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  if (!source || !target) return null;

  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2 - Math.min(28, Math.abs(target.x - source.x) * 0.08);
  const path = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;
  const attack = edge.type === 'attack_path';
  const color = attack ? palette.edgeAttack : edge.type === 'resolves_to' ? palette.edgeResolve : palette.edgeLink;
  const label = (edge.label ?? edge.type).replace('_', ' ').toUpperCase();
  const labelWidth = Math.max(48, label.length * NETMAP_EDGE_LABEL_FONT_SIZE * 0.62 + 12);

  return (
    <g
      className="pointer-events-auto select-none"
      data-edge-source={edge.source}
      data-edge-target={edge.target}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`${edge.type.replace('_', ' ')} relationship`}
      data-relationship-state={focused ? 'focused' : dimmed ? 'dimmed' : 'visible'}
      opacity={hovered || focused ? 1 : dimmed ? 0.035 : dense ? 0.34 : 0.78}
    >
      <path d={path} fill="none" stroke={palette.edgeBase} strokeWidth={attack ? 5 : 3} opacity=".38" />
      <path
        d={path}
        className={attack ? 'netmap-link-active' : undefined}
        fill="none"
        stroke={attack || edge.type === 'resolves_to' ? color : 'url(#netmap-link-gradient)'}
        strokeDasharray={attack ? '7 5' : edge.type === 'belongs_to' ? '3 5' : undefined}
        strokeLinecap="round"
        strokeWidth={attack || focused ? 1.8 : 1.1}
        filter={dense && !hovered ? undefined : 'url(#netmap-soft-glow)'}
        opacity={attack ? 0.95 : 0.75}
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth="12" />
      {hovered && (
        <g
          data-testid="netmap-edge-label"
          transform={`translate(${midX} ${midY - 5})`}
          className="pointer-events-none"
        >
          <rect
            x={-labelWidth / 2}
            y={-NETMAP_EDGE_LABEL_HEIGHT / 2}
            width={labelWidth}
            height={NETMAP_EDGE_LABEL_HEIGHT}
            rx="2"
            fill={palette.edgeLabelFill}
            stroke={palette.edgeLabelStroke}
            strokeWidth=".6"
          />
          <text
            className="font-mono"
            fill={color}
            fontSize={NETMAP_EDGE_LABEL_FONT_SIZE}
            y="-0.5"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
});

const AssetNode = memo(function AssetNode({
  node,
  dragging,
  dense,
  visualScale,
  selected,
  highlighted,
  related,
  dimmed,
  palette,
  onDragStart,
  onHover,
  onSelect,
}: {
  node: GraphNode & Point;
  dragging: boolean;
  dense: boolean;
  visualScale: number;
  selected: boolean;
  highlighted: boolean;
  related: boolean;
  dimmed: boolean;
  palette: NetMapPalette;
  onDragStart: (node: GraphNode & Point, event: ReactMouseEvent<SVGGElement>) => void;
  onHover: (nodeId: string | null) => void;
  onSelect: (nodeId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = palette.nodeColors[node.status] ?? palette.nodeColors.untested;
  const riskSize = netmapNodeCoreSize(node, dense);
  const url = typeof node.properties?.url === 'string' ? node.properties.url : undefined;
  const secondaryLabel = node.ip ?? url ?? node.hostname ?? node.type.toUpperCase();
  const showSecondaryLabel = secondaryLabel.toLocaleLowerCase() !== node.label.toLocaleLowerCase();
  const showLabels = !dense || selected || highlighted || dragging || hovered;
  const showGlow = selected || highlighted || dragging || hovered;

  return (
    <g
      className={`netmap-node ${dragging ? 'cursor-grabbing' : 'cursor-move'}`}
      data-node-id={node.id}
      data-relationship-state={selected || hovered ? 'focused' : related ? 'related' : dimmed ? 'dimmed' : 'visible'}
      onMouseDown={(event) => onDragStart(node, event)}
      onMouseEnter={() => {
        setHovered(true);
        onHover(node.id);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      aria-label={`${node.label}, ${node.status}`}
      tabIndex={0}
      opacity={dimmed && !selected && !highlighted ? 0.2 : 1}
    >
      <g transform={`scale(${visualScale})`}>
      {(selected || highlighted) && (
        <circle
          data-testid="netmap-node-emphasis"
          r={riskSize + 7}
          fill="none"
          stroke={selected ? palette.nodeFocus : color}
          strokeWidth=".65"
          opacity=".3"
        />
      )}
      {showGlow && (
        <circle r={riskSize + 5} fill={color} opacity=".05" filter="url(#netmap-glow)" />
      )}
      <circle
        r={riskSize + 3}
        fill="none"
        stroke={color}
        strokeDasharray="2 5"
        strokeWidth=".65"
        opacity=".55"
      />
      <rect
        x={-riskSize / 1.42}
        y={-riskSize / 1.42}
        width={riskSize * 1.414}
        height={riskSize * 1.414}
        rx="2"
        transform="rotate(45)"
        fill={palette.nodeFill}
        stroke={selected ? palette.nodeFocus : color}
        strokeWidth={selected ? 1.8 : 1.15}
        filter={showGlow ? 'url(#netmap-soft-glow)' : undefined}
      />
      <g transform="scale(.82)">
        <NodeGlyph type={node.type} color={color} />
      </g>
      {node.vulnCount > 0 && (
        <g transform={`translate(${riskSize + 2} ${-riskSize - 2})`}>
          <circle r="8" fill={palette.badgeFill} stroke={palette.badgeText} strokeWidth=".8" />
          <text
            className="font-mono"
            dominantBaseline="central"
            fill={palette.badgeText}
            fontSize={APP_SUPPORTING_FONT_SIZE_PX}
            textAnchor="middle"
          >
            {node.vulnCount}
          </text>
        </g>
      )}
      {showLabels && <text
        className="font-mono select-none"
        y={riskSize + 19}
        fill={selected ? palette.nodeFocus : palette.nodeLabel}
        fontSize={APP_FONT_SIZE_PX}
        fontWeight="600"
        letterSpacing=".9"
        textAnchor="middle"
      >
        {node.label.toUpperCase()}
      </text>}
      {showLabels && showSecondaryLabel && (
        <text
          className="font-mono select-none"
          y={riskSize + 35}
          fill={palette.nodeSecondaryLabel}
          fontSize={APP_SUPPORTING_FONT_SIZE_PX}
          textAnchor="middle"
        >
          {secondaryLabel}
        </text>
      )}
      </g>
    </g>
  );
});

function NodeGlyph({ type, color }: { type: GraphNode['type']; color: string }) {
  if (type === 'local') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <rect x="-8" y="-6" width="16" height="11" rx="1.5" />
        <path d="M-4 8H4M0 5v3M-5-2h10" />
      </g>
    );
  }

  if (type === 'domain') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <circle r="7" />
        <path d="M-7 0H7M0-7c3 3.5 3 10.5 0 14M0-7c-3 3.5-3 10.5 0 14" />
      </g>
    );
  }

  if (type === 'webapp') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <rect x="-8" y="-6" width="16" height="12" rx="1.5" />
        <path d="M-8-2H8M-5-4h.01M-2-4h.01M1-4h.01M-4 1h8M-4 4h5" />
      </g>
    );
  }

  if (type === 'api') {
    return <path d="M-3-7c-4 0-4 3-4 5v1c0 2-1 3-3 3 2 0 3 1 3 3v1c0 2 0 5 4 5M3-7c4 0 4 3 4 5v1c0 2 1 3 3 3-2 0-3 1-3 3v1c0 2 0 5-4 5" fill="none" stroke={color} strokeWidth="1" />;
  }

  if (type === 'identity') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <circle cy="-4" r="3" /><path d="M-7 7c1-5 3-7 7-7s6 2 7 7" />
      </g>
    );
  }

  if (type === 'service') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <circle r="4" /><circle r="7" strokeDasharray="2 2" /><path d="M0-4V4M-4 0H4" />
      </g>
    );
  }

  if (type === 'subnet') {
    return (
      <g fill="none" stroke={color} strokeWidth=".9">
        <circle cx="-6" cy="4" r="2.5" />
        <circle cx="6" cy="4" r="2.5" />
        <circle cy="-5" r="2.5" />
        <path d="m-4-3 2 1M4-3 2-2M-3.5 4h7" />
      </g>
    );
  }

  return (
    <g fill="none" stroke={color} strokeWidth=".9">
      <rect x="-7" y="-6" width="14" height="5" rx="1" />
      <rect x="-7" y="2" width="14" height="5" rx="1" />
      <path d="M-4-3.5h.01M-4 4.5h.01M0-3.5h4M0 4.5h4" />
    </g>
  );
}

function MapControl({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: 'zoom-in' | 'zoom-out' | 'fit' | 'close';
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="ui-icon-button h-6 w-6 hover:border-accent-teal/30 hover:bg-accent-teal/10 hover:text-accent-teal select-none"
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toGraphPoint(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  view: GraphViewTransform,
): Point {
  const bounds = svg.getBoundingClientRect();
  return {
    x: (clientX - bounds.left - view.x) / view.scale,
    y: (clientY - bounds.top - view.y) / view.scale,
  };
}

function clampNodePosition(point: Point, viewport: { width: number; height: number }): Point {
  return {
    x: clamp(point.x, 38, Math.max(38, viewport.width - 38)),
    y: clamp(point.y, 34, Math.max(34, viewport.height - 42)),
  };
}
