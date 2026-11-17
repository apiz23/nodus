import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowLeft,
  Crosshair,
  ExternalLink,
  Focus,
  Maximize,
  Minus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { GraphEdge } from '../../src/links/graph.js';
import type { UiGraphCluster, UiNoteGraph } from '../../src/ui-server/dto.js';
import type { GraphTraversalMode } from '../../src/links/graph-paths.js';
import { DEFAULT_GRAPH_RENDER_LIMIT, type GraphPoint, type SavedGraphViewConfig } from './graph-saved-views';
import { GraphSavedViews } from './GraphSavedViews';
import { GraphPathExplorer } from './GraphPathExplorer';
import { GraphClusterInsights } from './GraphClusterInsights';
import { SidebarToggle } from './SidebarToggle';
import { api } from './api';
import {
  graphConnections,
  graphFolders,
  graphMetrics,
  graphNeighborhood,
  positionGraph,
  visibleGraph,
  type DisplayGraphNode,
} from './graph-model';
import { nearestGraphNode } from './graph-keyboard';
import { cn } from '@/lib/utils';
import {
  GRAPH_VIEW_HEIGHT,
  GRAPH_VIEW_WIDTH,
  centerGraphViewportOn,
  fitGraphViewportAroundPoint,
  centeredGraphViewport,
  clientToGraphViewBox,
  fitGraphViewport,
  graphViewportTransform,
  panGraphViewport,
  zoomGraphViewportAt,
  type GraphViewport,
} from './graph-viewport';
import './graph.css';

interface Props { revision: number; initialNoteId: string | null; vaultKey: string; onOpenNote: (id: string) => void; sidebarCollapsed: boolean; onToggleSidebar: () => void }
const ALL_FOLDERS = '__all__';
const ALL_CLUSTERS = '__all__';
const ALL_CONNECTIONS = '__all__';
const ISOLATED_CLUSTER = '__isolated__';

type Scope = 'all' | 'neighborhood';
type ConnectionFilter = 'all' | 'linked' | 'dense' | 'veryDense' | 'orphan';
type Interaction =
  | { type: 'pan'; pointerId: number; startClientX: number; startClientY: number; origin: GraphViewport; moved: boolean; captureTarget: Element }
  | { type: 'node'; pointerId: number; nodeId: string; startClientX: number; startClientY: number; originX: number; originY: number; moved: boolean; captureTarget: Element };

interface ContextMenuState { nodeId: string; x: number; y: number }

export function GraphView({ revision, initialNoteId, vaultKey, onOpenNote, sidebarCollapsed, onToggleSidebar }: Props) {
  const [graph, setGraph] = useState<UiNoteGraph | null>(null);
  const [clusters, setClusters] = useState<UiGraphCluster[]>([]);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>('all');
  const [showIsolated, setShowIsolated] = useState(true);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [focusDepth, setFocusDepth] = useState(1);
  const [focusHistory, setFocusHistory] = useState<string[]>([]);
  const [pathMode, setPathMode] = useState<GraphTraversalMode>('directed');
  const [renderLimit, setRenderLimit] = useState(DEFAULT_GRAPH_RENDER_LIMIT);
  const [nodePositions, setNodePositions] = useState<Record<string, GraphPoint>>({});
  const [viewport, setViewport] = useState<GraphViewport>(centeredGraphViewport());
  const [panning, setPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fitEpoch, setFitEpoch] = useState(0);
  const [revealEpoch, setRevealEpoch] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: GRAPH_VIEW_WIDTH, height: GRAPH_VIEW_HEIGHT });
  const request = useRef(0);
  const mounted = useRef(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const viewportRef = useRef(viewport);
  const nodePositionsRef = useRef(nodePositions);
  const interaction = useRef<Interaction | null>(null);
  const frame = useRef<number | null>(null);
  const pendingViewport = useRef<GraphViewport | null>(null);
  const pendingPositions = useRef<Record<string, GraphPoint>>({});
  const pendingReveal = useRef<string | null>(null);
  const pendingFit = useRef(true);
  const lastDragAt = useRef(0);
  viewportRef.current = viewport;
  nodePositionsRef.current = nodePositions;

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const [graphResult, clusterResult] = await Promise.allSettled([api.graph(refresh), api.graphClusters(refresh)]);
      if (!mounted.current || current !== request.current) return;
      if (graphResult.status === 'rejected') throw graphResult.reason;
      const result = graphResult.value;
      setGraph(result);
      if (clusterResult.status === 'fulfilled') {
        setClusters(clusterResult.value.clusters);
        setClusterError(null);
        setClusterId((id) => id === null || id === ISOLATED_CLUSTER || clusterResult.value.clusters.some((cluster) => cluster.id === id && cluster.size > 1) ? id : null);
      } else {
        setClusters([]);
        setClusterId(null);
        setClusterError(clusterResult.reason instanceof Error ? clusterResult.reason.message : 'Clusters could not be loaded.');
      }
      setSelectedId((id) => id && result.nodes.some((node) => node.id === id) ? id : null);
      setFocusId((id) => id && result.nodes.some((node) => node.id === id) ? id : null);
      setFocusHistory((history) => history.filter((id) => result.nodes.some((node) => node.id === id)));
      setNodePositions((positions) => Object.fromEntries(Object.entries(positions).filter(([id]) => result.nodes.some((node) => node.id === id))));
      pendingFit.current = true;
      setFitEpoch((value) => value + 1);
    } catch (reason) {
      if (mounted.current && current === request.current) setError(reason instanceof Error ? reason.message : 'Could not load the local note graph.');
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      interaction.current = null;
    };
  }, [revision]);

  const folders = useMemo(() => graphFolders(graph?.nodes ?? []), [graph]);
  const metrics = useMemo(() => graph === null ? null : graphMetrics(graph), [graph]);
  const selectedCluster = clusterId === ISOLATED_CLUSTER
    ? null
    : clusters.find((cluster) => cluster.id === clusterId) ?? null;
  const clusterNodeIds = useMemo(() => {
    if (clusterId === null) return null;
    if (clusterId === ISOLATED_CLUSTER) return new Set(graph?.isolatedNodeIds ?? []);
    return new Set(selectedCluster?.members.map((member) => member.id) ?? []);
  }, [clusterId, selectedCluster, graph]);
  const visible = useMemo(() => {
    if (graph === null) return null;
    const minConnections = connectionFilter === 'dense' ? 3 : connectionFilter === 'veryDense' ? 5 : connectionFilter === 'linked' ? 1 : null;
    return visibleGraph(graph, query, scope === 'neighborhood' ? focusId : null, renderLimit, {
      folder,
      showIsolated,
      showUnresolved,
      clusterNodeIds,
      priorityIds: selectedCluster?.members.map((member) => member.id),
      ensureIds: selectedId === null ? [] : [selectedId],
      minConnections,
      orphanOnly: connectionFilter === 'orphan',
      focusDepth,
    });
  }, [graph, query, folder, scope, focusId, renderLimit, showIsolated, showUnresolved, clusterNodeIds, selectedCluster, selectedId, connectionFilter, focusDepth]);
  const clusterByNode = useMemo(() => new Map(clusters.flatMap((cluster) => cluster.members.map((member) => [member.id, cluster.id] as const))), [clusters]);
  const isolatedNodeIds = useMemo(() => new Set(graph?.isolatedNodeIds ?? []), [graph]);
  const layoutFocusId = useMemo(() => {
    if (visible === null) return null;
    if (scope === 'neighborhood') return focusId;
    let best: { id: string; degree: number } | null = null;
    for (const node of visible.nodes) {
      if (node.unresolved === true) continue;
      const degree = metrics?.degree.get(node.id) ?? 0;
      if (best === null || degree > best.degree) best = { id: node.id, degree };
    }
    return best?.id ?? null;
  }, [visible, scope, focusId, metrics]);
  const layoutDepth = useMemo(() => {
    if (graph === null || layoutFocusId === null) return null;
    return graphNeighborhood(graph, layoutFocusId, 3).distanceById;
  }, [graph, layoutFocusId]);
  const basePositions = useMemo(() => visible === null
    ? []
    : positionGraph(visible.nodes, layoutFocusId, GRAPH_VIEW_WIDTH, GRAPH_VIEW_HEIGHT, {
      clusterByNode,
      isolatedNodeIds,
      edges: visible.edges,
      depthByNode: layoutDepth ?? visible.distanceById,
      spacingX: scope === 'neighborhood' ? 150 : 122,
    }), [visible, layoutFocusId, layoutDepth, clusterByNode, isolatedNodeIds, scope]);
  const positions = useMemo(() => basePositions.map((node) => {
    const manual = nodePositions[node.id];
    return manual === undefined ? node : { ...node, x: manual.x, y: manual.y };
  }), [basePositions, nodePositions]);
  const positionsById = useMemo(() => new Map(positions.map((node) => [node.id, node])), [positions]);
  const selected = visible?.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedIsHidden = selectedId !== null && selected === null && graph?.nodes.some((node) => node.id === selectedId) === true;
  const connections = useMemo(
    () => visible && selected ? graphConnections(visible.edges, selected.id) : { incoming: [], outgoing: [] },
    [visible, selected],
  );
  const emphasizedId = hoveredId ?? selectedId;
  const emphasizedConnections = useMemo(
    () => visible && emphasizedId !== null ? graphConnections(visible.edges, emphasizedId) : { incoming: [], outgoing: [] },
    [visible, emphasizedId],
  );
  const neighborIds = useMemo(() => new Set([
    ...(emphasizedId === null ? [] : [emphasizedId]),
    ...emphasizedConnections.incoming.map((edge) => edge.sourceId),
    ...emphasizedConnections.outgoing.map((edge) => edge.targetId),
  ]), [emphasizedId, emphasizedConnections]);
  const nodeById = useMemo(() => new Map(visible?.nodes.map((node) => [node.id, node]) ?? []), [visible]);
  const hovered = hoveredId === null ? null : nodeById.get(hoveredId) ?? null;
  const center = focusId === null ? null : graph?.nodes.find((node) => node.id === focusId) ?? null;
  const centerCandidate = selected && selected.unresolved !== true ? selected.id
    : focusId ?? (initialNoteId !== null && graph?.nodes.some((node) => node.id === initialNoteId) ? initialNoteId : null);
  const degreeOf = (id: string) => metrics?.degree.get(id) ?? 0;
  const labelIds = useMemo(() => {
    const ids = new Set<string>();
    if (emphasizedId !== null) ids.add(emphasizedId);
    if (focusId !== null) ids.add(focusId);
    for (const id of neighborIds) ids.add(id);
    if (visible === null) return ids;
    if (visible.nodes.length <= 80 || viewport.scale >= 0.95) {
      for (const node of visible.nodes) ids.add(node.id);
    } else {
      for (const node of [...visible.nodes].sort((left, right) => degreeOf(right.id) - degreeOf(left.id)).slice(0, 32)) ids.add(node.id);
    }
    return ids;
  }, [visible, emphasizedId, focusId, neighborIds, viewport.scale, metrics]);

  useEffect(() => {
    if (!pendingFit.current || basePositions.length === 0) return;
    pendingFit.current = false;
    const manual = nodePositionsRef.current;
    const next = fitGraphViewportAroundPoint(
      basePositions.map((node) => {
        const position = manual[node.id];
        return position === undefined ? node : { ...node, x: position.x, y: position.y };
      }),
      layoutFocusId === null ? null : { x: basePositions.find((node) => node.id === layoutFocusId)?.x ?? 0, y: basePositions.find((node) => node.id === layoutFocusId)?.y ?? 0 },
    );
    viewportRef.current = next;
    setViewport(next);
  }, [basePositions, fitEpoch, layoutFocusId]);

  useEffect(() => {
    const revealId = pendingReveal.current;
    if (revealId === null) return;
    const position = positionsById.get(revealId);
    if (position === undefined) return;
    pendingReveal.current = null;
    setViewportNow(centerGraphViewportOn(position, viewportRef.current.scale));
  }, [positionsById, revealEpoch]);

  useEffect(() => {
    const element = canvasRef.current;
    if (element === null || !('ResizeObserver' in window)) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const point = clientToGraphViewBox(event.clientX, event.clientY, bounds);
      const raw = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const delta = Math.max(-240, Math.min(240, raw));
      const factor = Math.max(0.67, Math.min(1.5, Math.exp(-delta * (event.ctrlKey ? 0.0025 : 0.0016))));
      pendingViewport.current = zoomGraphViewportAt(pendingViewport.current ?? viewportRef.current, point, factor);
      scheduleFrame();
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [graph]);

  useEffect(() => {
    if (contextMenu === null) return undefined;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-graph-context-menu]')) setContextMenu(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [contextMenu]);

  function requestFit() {
    pendingFit.current = true;
    setFitEpoch((value) => value + 1);
  }
  function selectNode(id: string, reveal = false) {
    setSelectedId(id);
    setNotice(null);
    if (reveal) { pendingReveal.current = id; setRevealEpoch((value) => value + 1); }
  }
  function scheduleFrame() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const nextViewport = pendingViewport.current;
      if (nextViewport !== null) {
        pendingViewport.current = null;
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
      }
      const nextPositions = pendingPositions.current;
      pendingPositions.current = {};
      if (Object.keys(nextPositions).length > 0) setNodePositions((current) => ({ ...current, ...nextPositions }));
    });
  }
  function setViewportNow(next: GraphViewport) {
    pendingViewport.current = next;
    scheduleFrame();
  }
  function zoomAt(point: { x: number; y: number }, factor: number) {
    setViewportNow(zoomGraphViewportAt(pendingViewport.current ?? viewportRef.current, point, factor));
  }
  function zoom(factor: number) { zoomAt({ x: GRAPH_VIEW_WIDTH / 2, y: GRAPH_VIEW_HEIGHT / 2 }, factor); }
  function fitViewport() {
    const manual = nodePositionsRef.current;
    const positions = basePositions.map((node) => {
      const position = manual[node.id];
      return position === undefined ? node : { ...node, x: position.x, y: position.y };
    });
    const centerNode = layoutFocusId === null ? null : positions.find((node) => node.id === layoutFocusId) ?? null;
    setViewportNow(fitGraphViewportAroundPoint(positions, centerNode === null ? null : { x: centerNode.x, y: centerNode.y }));
  }
  function resetViewport() { setContextMenu(null); setViewportNow(centeredGraphViewport()); }
  function clearNodePositions() {
    setNodePositions({});
    setContextMenu(null);
    requestFit();
  }
  function focusGraph(id: string) {
    if (focusId !== null && focusId !== id) setFocusHistory((history) => [...history.slice(-9), focusId]);
    setFocusId(id);
    setSelectedId(id);
    setScope('neighborhood');
    requestFit();
  }
  function clearFocus() {
    if (focusId !== null) setFocusHistory((history) => [...history.slice(-9), focusId]);
    setFocusId(null);
    setScope('all');
    requestFit();
  }
  function backFocus() {
    const previous = focusHistory.at(-1) ?? null;
    setFocusHistory((history) => history.slice(0, -1));
    setFocusId(previous);
    if (previous !== null) setSelectedId(previous);
    setScope(previous === null ? 'all' : 'neighborhood');
    requestFit();
  }
  function centerView() {
    if (center === null) return;
    selectNode(center.id, true);
    requestFit();
  }
  function resetFilters() {
    setQuery('');
    setFolder(null);
    setClusterId(null);
    setConnectionFilter('all');
    setShowIsolated(true);
    setShowUnresolved(true);
    setFocusId(null);
    setScope('all');
    setFocusDepth(1);
    setFocusHistory([]);
    setSelectedId(null);
    setPathMode('directed');
    setRenderLimit(DEFAULT_GRAPH_RENDER_LIMIT);
    setNodePositions({});
    setContextMenu(null);
    setNotice(null);
    requestFit();
  }
  function captureConfig(): SavedGraphViewConfig {
    return { query, folder, clusterId, focusId: scope === 'neighborhood' ? focusId : null, selectedId, showIsolated, showUnresolved, pathMode, viewport: viewportRef.current, renderLimit, nodePositions: nodePositionsRef.current };
  }
  function applySavedConfig(config: SavedGraphViewConfig) {
    setQuery(config.query);
    setFolder(config.folder);
    setClusterId(config.clusterId === null || config.clusterId === ISOLATED_CLUSTER || clusters.some((cluster) => cluster.id === config.clusterId && cluster.size > 1) ? config.clusterId : null);
    setShowIsolated(config.showIsolated);
    setShowUnresolved(config.showUnresolved);
    setPathMode(config.pathMode);
    setRenderLimit(config.renderLimit);
    setNodePositions(config.nodePositions ?? {});
    pendingFit.current = false;
    viewportRef.current = config.viewport;
    setViewport(config.viewport);
    setFocusHistory([]);
    const existing = new Set(graph?.nodes.map((node) => node.id) ?? []);
    setFocusId(config.focusId !== null && existing.has(config.focusId) ? config.focusId : null);
    setScope(config.focusId !== null && existing.has(config.focusId) ? 'neighborhood' : 'all');
    setSelectedId(config.selectedId !== null && existing.has(config.selectedId) ? config.selectedId : null);
  }
  function edgePath(edge: GraphEdge) {
    const source = positionsById.get(edge.sourceId), target = positionsById.get(edge.targetId);
    if (!source || !target) return '';
    if (source.id === target.id) return `M ${source.x - 8} ${source.y - 17} C ${source.x - 65} ${source.y - 88}, ${source.x + 65} ${source.y - 88}, ${source.x + 8} ${source.y - 17}`;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const sourceRadius = nodeRadius(source, degreeOf(source.id), visualScale);
    const targetRadius = nodeRadius(target, degreeOf(target.id), visualScale) + 3;
    const startX = source.x + (dx / distance) * sourceRadius;
    const startY = source.y + (dy / distance) * sourceRadius;
    const endX = target.x - (dx / distance) * targetRadius;
    const endY = target.y - (dy / distance) * targetRadius;
    const direction = edge.sourceId < edge.targetId ? 1 : -1;
    const bend = Math.min(24, distance * 0.08) * direction;
    const midX = (startX + endX) / 2 - (dy / distance) * bend;
    const midY = (startY + endY) / 2 + (dx / distance) * bend;
    return `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
  }
  function openContextMenu(event: ReactMouseEvent, node: DisplayGraphNode) {
    event.preventDefault();
    event.stopPropagation();
    const box = canvasRef.current?.getBoundingClientRect();
    if (box === undefined) return;
    selectNode(node.id);
    setContextMenu({
      nodeId: node.id,
      x: Math.max(8, Math.min(box.width - 200, event.clientX - box.left)),
      y: Math.max(8, Math.min(box.height - 180, event.clientY - box.top)),
    });
  }
  function focusNode(id: string) {
    const element = nodeRefs.current.get(id);
    element?.focus();
    selectNode(id);
  }
  function handleNodeKeyDown(event: ReactKeyboardEvent<SVGGElement>, node: DisplayGraphNode) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        if (node.unresolved !== true) onOpenNote(node.id);
      } else {
        selectNode(node.id);
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const current = positionsById.get(node.id);
      if (current === undefined) return;
      const next = nearestGraphNode(current, positions.filter((candidate) => candidate.id !== node.id), event.key);
      if (next !== null) focusNode(next);
    }
  }
  function handleCanvasKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.15); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.15); }
    else if (event.key === '0' || event.key.toLowerCase() === 'f') { event.preventDefault(); fitViewport(); }
    else if (event.key === 'Escape') {
      if (selectedId !== null) { event.preventDefault(); setSelectedId(null); setContextMenu(null); }
      else if (scope === 'neighborhood') { event.preventDefault(); clearFocus(); }
    }
  }

  const selectedIsUnresolved = selected?.unresolved === true;
  const confirmedShown = visible?.edges.filter((edge) => edge.unresolved !== true).length ?? 0;
  const zoomPercent = Math.round(viewport.scale * 100);
  const visualScale = Math.max(0.01, Math.min(canvasSize.width / GRAPH_VIEW_WIDTH, canvasSize.height / GRAPH_VIEW_HEIGHT) * viewport.scale);
  const rovingId = selected?.id ?? focusedId ?? positions[0]?.id ?? null;

  return <section className="nodus-graph-page flex min-h-0 flex-1 flex-col" aria-label="Local note graph" aria-busy={loading}>
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
      <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      <Network className="size-4 text-muted-foreground" aria-hidden="true" />
      <h1 className="flex-1 text-sm font-medium">Local graph</h1>
      <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5" role="group" aria-label="Graph scope">
        <Button variant={scope === 'all' ? 'secondary' : 'ghost'} size="sm" aria-pressed={scope === 'all'} className="h-7 rounded-sm px-2.5" onClick={() => { setScope('all'); setFocusId(null); requestFit(); }}>Whole vault</Button>
        <Button variant={scope === 'neighborhood' ? 'secondary' : 'ghost'} size="sm" aria-pressed={scope === 'neighborhood'} className="h-7 rounded-sm px-2.5" onClick={() => {
          const next = selected && selected.unresolved !== true ? selected.id : centerCandidate;
          if (next === null) { setNotice('Select a note first, then open its neighborhood.'); return; }
          focusGraph(next);
        }}>Around note</Button>
      </div>
      {scope === 'neighborhood' ? <Select value={String(focusDepth)} onValueChange={(value) => { setFocusDepth(Number(value)); requestFit(); }}>
        <SelectTrigger className="h-8 w-28" aria-label="Neighborhood depth"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="1">1 hop</SelectItem>
          <SelectItem value="2">2 hops</SelectItem>
          <SelectItem value="3">3 hops</SelectItem>
        </SelectContent>
      </Select> : null}
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)} aria-label="Refresh from disk">
        <RefreshCw className={loading ? 'animate-spin' : undefined} data-icon="inline-start" />Refresh
      </Button>
    </header>

    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="graph-filter"
            type="search"
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const first = visible?.nodes[0];
                if (first !== undefined) { selectNode(first.id, true); focusNode(first.id); }
              } else if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Filter notes by title or path"
            aria-label="Filter notes by title or path"
          />
        </div>
        <div className="graph-advanced hidden md:contents">
        <Select value={folder ?? ALL_FOLDERS} onValueChange={(value) => setFolder(value === ALL_FOLDERS ? null : value)}>
          <SelectTrigger className="w-40" aria-label="Filter by folder"><SelectValue placeholder="All folders" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FOLDERS}>All folders</SelectItem>
            {folders.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clusterId ?? ALL_CLUSTERS} onValueChange={(value) => { setClusterId(value === ALL_CLUSTERS ? null : value); setSelectedId(null); setFocusId(null); setScope('all'); setFocusHistory([]); }}>
          <SelectTrigger className="w-48" aria-label="Filter by knowledge cluster"><SelectValue placeholder="All clusters" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLUSTERS}>All clusters</SelectItem>
            {graph?.isolatedNodeIds?.length ? <SelectItem value={ISOLATED_CLUSTER}>Isolated notes ({graph.isolatedNodeIds.length})</SelectItem> : null}
            {clusters.filter((cluster) => cluster.size > 1).map((cluster) => (
              <SelectItem key={cluster.id} value={cluster.id}>{cluster.representative.title} · {cluster.size} notes</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={connectionFilter} onValueChange={(value) => setConnectionFilter(value as ConnectionFilter)}>
          <SelectTrigger className="w-36" aria-label="Filter by connection count"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any connections</SelectItem>
            <SelectItem value="linked">1+ links</SelectItem>
            <SelectItem value="dense">3+ links</SelectItem>
            <SelectItem value="veryDense">5+ links</SelectItem>
            <SelectItem value="orphan">Orphans only</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={showIsolated} onCheckedChange={(checked) => setShowIsolated(checked === true)} aria-label="Show isolated notes" />
          Isolated notes
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={showUnresolved} onCheckedChange={(checked) => setShowUnresolved(checked === true)} aria-label="Show unresolved links" />
          Unresolved links
        </label>
        <Select value={String(renderLimit)} onValueChange={(value) => setRenderLimit(Number(value))}>
          <SelectTrigger className="w-32" aria-label="Graph render limit"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="100">100 nodes</SelectItem>
            <SelectItem value="200">200 nodes</SelectItem>
            <SelectItem value="400">400 nodes</SelectItem>
          </SelectContent>
        </Select>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="md:hidden"><SlidersHorizontal data-icon="inline-start" />Filters</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="grid gap-3">
              <Select value={folder ?? ALL_FOLDERS} onValueChange={(value) => setFolder(value === ALL_FOLDERS ? null : value)}>
                <SelectTrigger aria-label="Filter by folder"><SelectValue placeholder="All folders" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FOLDERS}>All folders</SelectItem>
                  {folders.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={clusterId ?? ALL_CLUSTERS} onValueChange={(value) => { setClusterId(value === ALL_CLUSTERS ? null : value); setSelectedId(null); setFocusId(null); setScope('all'); setFocusHistory([]); }}>
                <SelectTrigger aria-label="Filter by knowledge cluster"><SelectValue placeholder="All clusters" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CLUSTERS}>All clusters</SelectItem>
                  {graph?.isolatedNodeIds?.length ? <SelectItem value={ISOLATED_CLUSTER}>Isolated notes ({graph.isolatedNodeIds.length})</SelectItem> : null}
                  {clusters.filter((cluster) => cluster.size > 1).map((cluster) => (
                    <SelectItem key={cluster.id} value={cluster.id}>{cluster.representative.title} · {cluster.size} notes</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={connectionFilter} onValueChange={(value) => setConnectionFilter(value as ConnectionFilter)}>
                <SelectTrigger aria-label="Filter by connection count"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any connections</SelectItem>
                  <SelectItem value="linked">1+ links</SelectItem>
                  <SelectItem value="dense">3+ links</SelectItem>
                  <SelectItem value="veryDense">5+ links</SelectItem>
                  <SelectItem value="orphan">Orphans only</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showIsolated} onCheckedChange={(checked) => setShowIsolated(checked === true)} aria-label="Show isolated notes" />
                Show isolated notes
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showUnresolved} onCheckedChange={(checked) => setShowUnresolved(checked === true)} aria-label="Show unresolved links" />
                Show unresolved links
              </label>
              <Select value={String(renderLimit)} onValueChange={(value) => setRenderLimit(Number(value))}>
                <SelectTrigger aria-label="Graph render limit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100 nodes</SelectItem>
                  <SelectItem value="200">200 nodes</SelectItem>
                  <SelectItem value="400">400 nodes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus /></Button>
        <Button variant="outline" size="sm" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus /></Button>
        <span className="min-w-10 text-center font-mono text-[11px] tabular-nums text-muted-foreground" aria-live="polite">{zoomPercent}%</span>
        <Button variant="outline" size="sm" onClick={fitViewport} aria-label="Fit graph to screen"><Maximize data-icon="inline-start" />Fit</Button>
        <Button variant="outline" size="sm" onClick={resetViewport}><RotateCcw data-icon="inline-start" />Reset view</Button>
        <Button variant="ghost" size="sm" onClick={clearNodePositions}>Re-layout</Button>
        <Button variant="ghost" size="sm" onClick={resetFilters}>Reset filters</Button>
        {focusHistory.length > 0 ? <Button variant="ghost" size="sm" onClick={backFocus}><ArrowLeft data-icon="inline-start" />Previous focus</Button> : null}
        {scope === 'neighborhood' && center !== null ? <Button variant="ghost" size="sm" onClick={centerView}><Focus data-icon="inline-start" />Center view</Button> : null}
        {scope === 'neighborhood' ? <Button variant="ghost" size="sm" onClick={clearFocus}>Show full graph</Button> : null}
      </div>

      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button></div> : null}
      {loading && graph === null ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading note graph…</p> : null}
      {!loading && !error && graph?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-12 text-center"><h2 className="font-medium">No notes to map yet</h2><p className="mt-1 text-sm text-muted-foreground">Create Markdown notes and connect them with wiki links such as [[Note title]].</p></div> : null}
      {graph && graph.nodes.length > 0 && visible?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-10 text-center"><h2 className="font-medium">No matching notes</h2><p className="mt-1 text-sm text-muted-foreground">Try another title, folder, connection filter, or scope.</p><Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>Clear filters</Button></div> : null}

      {graph && visible && visible.nodes.length > 0 ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>{visible.noteCount} of {graph.nodes.length} notes shown</span>
          <span>{confirmedShown} confirmed links shown · {graph.edges.length} total</span>
          <span>{visible.matched} matching · {visible.hiddenByLimit} hidden by the {renderLimit}-node limit</span>
          {visible.unresolvedCount > 0 ? <Badge variant="secondary">{visible.unresolvedCount} unresolved {visible.unresolvedCount === 1 ? 'target' : 'targets'} shown</Badge> : null}
          {!showUnresolved && graph.unresolvedCount > 0 ? <Badge variant="secondary">{graph.unresolvedCount} unresolved occurrences hidden</Badge> : null}
          {graph.ambiguousCount ? <Badge variant="secondary">{graph.ambiguousCount} ambiguous occurrences excluded</Badge> : null}
          {visible.truncated ? <span>Showing the first {renderLimit}; filter, focus, or reduce the render limit to explore more.</span> : null}
          {clusterError ? <span role="alert" className="text-destructive">Cluster filter unavailable: {clusterError}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <GraphSavedViews vaultKey={vaultKey} references={{ noteIds: new Set(graph?.nodes.map((node) => node.id) ?? []), folderPaths: new Set(folders), clusterIds: new Set(clusters.filter((cluster) => cluster.size > 1).map((cluster) => cluster.id)) }} captureConfig={captureConfig} onApply={applySavedConfig} />
        </div>
        {clusterId === null ? null : <GraphClusterInsights clusterId={clusterId} isolatedCount={graph?.isolatedNodeIds?.length ?? 0} onSelectNode={(id) => selectNode(id, true)} onOpenNote={onOpenNote} />}
        <div className="grid min-h-[28rem] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div ref={canvasRef} className="nodus-graph-surface relative min-h-[24rem] overflow-hidden rounded-md border bg-card">
            <div className="nodus-graph-toolbar" aria-hidden="true">
              <span>{visible.noteCount} notes</span>
              <span>{confirmedShown} edges</span>
              <span>{zoomPercent}%</span>
            </div>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${GRAPH_VIEW_WIDTH} ${GRAPH_VIEW_HEIGHT}`}
              role="group"
              aria-label="Directed wiki-link graph"
              aria-describedby="graph-keyboard-help"
              className={cn('nodus-graph-canvas size-full min-h-[24rem] touch-none select-none', panning || draggingNodeId !== null ? 'cursor-grabbing' : 'cursor-grab')}
              data-graph-canvas="true"
              onKeyDown={handleCanvasKeyDown}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as Element).closest('[data-graph-node]')) return;
                event.preventDefault();
                setContextMenu(null);
                interaction.current = { type: 'pan', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, origin: viewportRef.current, moved: false, captureTarget: event.currentTarget };
                event.currentTarget.setPointerCapture(event.pointerId);
                setPanning(true);
              }}
              onPointerMove={(event) => {
                const active = interaction.current;
                if (active === null || active.pointerId !== event.pointerId) return;
                const distance = Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY);
                if (distance > 4) active.moved = true;
                if (active.type === 'pan') {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  pendingViewport.current = panGraphViewport(active.origin, event.clientX - active.startClientX, event.clientY - active.startClientY, bounds);
                  scheduleFrame();
                } else {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const displayScale = Math.min(bounds.width / GRAPH_VIEW_WIDTH, bounds.height / GRAPH_VIEW_HEIGHT);
                  const scale = Math.max(0.01, displayScale * viewportRef.current.scale);
                  const x = active.originX + (event.clientX - active.startClientX) / scale;
                  const y = active.originY + (event.clientY - active.startClientY) / scale;
                  pendingPositions.current[active.nodeId] = { x: Math.max(-5000, Math.min(5000, x)), y: Math.max(-5000, Math.min(5000, y)) };
                  scheduleFrame();
                }
              }}
              onPointerUp={(event) => {
                const active = interaction.current;
                if (active === null || active.pointerId !== event.pointerId) return;
                if (active.type === 'node') {
                  if (active.moved) lastDragAt.current = Date.now();
                  else selectNode(active.nodeId);
                } else if (!active.moved) {
                  setSelectedId(null);
                  setHoveredId(null);
                }
                interaction.current = null;
                setPanning(false);
                setDraggingNodeId(null);
                if (active.captureTarget.hasPointerCapture?.(event.pointerId)) active.captureTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { interaction.current = null; setPanning(false); setDraggingNodeId(null); }}
              onPointerLeave={() => setHoveredId(null)}
              onDragStart={(event) => event.preventDefault()}
            >
              <defs><marker id="graph-arrow" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0,6 L6,3 z" className="fill-muted-foreground" /></marker></defs>
              <g data-graph-viewport="true" data-scale={viewport.scale} transform={graphViewportTransform(viewport)}>
                {visible.edges.map((edge) => {
                  const active = emphasizedId !== null && (edge.sourceId === emphasizedId || edge.targetId === emphasizedId);
                  const dimmed = emphasizedId !== null && !active;
                  return <path
                    key={`${edge.sourceId}:${edge.targetId}`}
                    d={edgePath(edge)}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    className={cn('nodus-graph-edge', edge.unresolved && 'is-unresolved', active && 'is-active', dimmed && 'is-dimmed')}
                    strokeWidth={Math.min(4, 1.15 + Math.log2(edge.linkCount) * 0.7)}
                    markerEnd={active && edge.unresolved !== true ? 'url(#graph-arrow)' : undefined}
                  >
                    <title>{nodeById.get(edge.sourceId)?.title} links to {nodeById.get(edge.targetId)?.title}{edge.linkCount > 1 ? ` (${edge.linkCount} wiki links)` : ''}{edge.snippets[0] ? `: ${edge.snippets[0]}` : ''}</title>
                  </path>;
                })}
                {positions.map((node) => {
                  const nodeSelected = selectedId === node.id;
                  const nodeFocused = focusedId === node.id;
                  const neighbor = neighborIds.has(node.id);
                  const radius = node.id === selectedId ? Math.max(11, nodeRadius(node, degreeOf(node.id), visualScale)) : nodeRadius(node, degreeOf(node.id), visualScale);
                  const showLabel = labelIds.has(node.id);
                  const labelSize = Math.min(30, 12 / visualScale);
                  return <g
                    key={node.id}
                    ref={(element) => { if (element === null) nodeRefs.current.delete(node.id); else nodeRefs.current.set(node.id, element); }}
                    data-graph-node="true"
                    data-degree={degreeOf(node.id)}
                    data-distance={node.distance}
                    data-unresolved={node.unresolved === true ? 'true' : undefined}
                    role="button"
                    tabIndex={nodeFocused || rovingId === node.id ? 0 : -1}
                    aria-label={node.unresolved === true ? `Select unresolved target ${node.title}` : `Select ${node.title}`}
                    aria-pressed={nodeSelected}
                    aria-describedby="graph-keyboard-help"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      const position = positionsById.get(node.id);
                      if (position === undefined) return;
                      setContextMenu(null);
                      interaction.current = { type: 'node', pointerId: event.pointerId, nodeId: node.id, startClientX: event.clientX, startClientY: event.clientY, originX: position.x, originY: position.y, moved: false, captureTarget: event.currentTarget };
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDraggingNodeId(node.id);
                    }}
                    onClick={(event) => { event.stopPropagation(); selectNode(node.id); }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (node.unresolved !== true && Date.now() - lastDragAt.current > 350) onOpenNote(node.id);
                    }}
                    onContextMenu={(event) => openContextMenu(event, node)}
                    onPointerEnter={() => setHoveredId(node.id)}
                    onPointerLeave={() => setHoveredId((current) => current === node.id ? null : current)}
                    onFocus={() => setFocusedId(node.id)}
                    onBlur={() => setFocusedId((current) => current === node.id ? null : current)}
                    onKeyDown={(event) => handleNodeKeyDown(event, node)}
                    className={cn('nodus-graph-node', nodeSelected && 'is-selected', neighbor && emphasizedId !== null && 'is-neighbor', nodeFocused && 'is-focused', node.unresolved === true && 'is-unresolved', hoveredId === node.id && 'is-hovered', layoutFocusId === node.id && scope === 'all' && 'is-center')}
                  >
                    <ellipse className="nodus-graph-node-halo" cx={node.x} cy={node.y} rx={radius + 7} ry={radius + 7} />
                    <circle className="nodus-graph-node-core" cx={node.x} cy={node.y} r={radius} strokeWidth={nodeFocused ? 4 : 2} />
                    <ellipse className="nodus-graph-node-hit" cx={node.x} cy={node.y} rx={Math.max(radius + 8, 12 / visualScale)} ry={Math.max(radius + 8, 12 / visualScale)} />
                    {nodeSelected || nodeFocused ? <ellipse className="nodus-graph-node-focus" cx={node.x} cy={node.y} rx={radius + 5} ry={radius + 5} /> : null}
                    {showLabel ? <text
                      x={node.x}
                      y={node.y + radius + 14 / visualScale}
                      textAnchor="middle"
                      className="nodus-graph-label"
                      style={{ fontSize: `${labelSize}px`, strokeWidth: `${3 / visualScale}px` }}
                    >{labelFor(node.title)}</text> : null}
                    <title>{node.unresolved === true ? `Unresolved target: ${node.title}` : `${node.title} · ${node.path} · ${degreeOf(node.id)} connections (double-click to open)`}</title>
                  </g>;
                })}
              </g>
            </svg>
            <div className="nodus-graph-hint" aria-hidden="true">Drag to pan · Scroll to zoom · Double-click a note to open · Arrow keys move focus</div>
            {hovered !== null ? <div className="nodus-graph-hover" aria-hidden="true">
              <span className="nodus-graph-hover-title">{hovered.title}</span>
              <span className="nodus-graph-hover-path">{hovered.path}</span>
              <span className="nodus-graph-hover-meta">{degreeOf(hovered.id)} connections · {hovered.unresolved === true ? 'unresolved link' : 'note'}</span>
            </div> : null}
            {contextMenu !== null ? <GraphContextMenu
              menu={contextMenu}
              node={nodeById.get(contextMenu.nodeId) ?? null}
              centerId={focusId}
              onOpenNote={onOpenNote}
              onSetCenter={(id) => { focusGraph(id); setContextMenu(null); }}
              onReveal={(id) => { selectNode(id, true); setContextMenu(null); }}
              onClear={() => { setSelectedId(null); setContextMenu(null); }}
              onClose={() => setContextMenu(null)}
            /> : null}
          </div>

          <aside className="flex min-h-0 flex-col gap-3 rounded-md border p-3" aria-label="Selected note connections">
            {selectedIsHidden ? <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Selected note is outside the current filters.</p>
              <p className="mt-1">The note still exists in the vault.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSelectedId(null)}>Clear selection</Button>
            </div> : null}
            {selected ? <>
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {selectedIsUnresolved ? <Badge variant="outline">Unresolved target</Badge> : null}
                  {selected.unresolved !== true && metrics?.isolatedIds.has(selected.id) ? <Badge variant="secondary">Isolated</Badge> : null}
                  {selected.unresolved !== true && metrics?.orphanIds.has(selected.id) && !metrics.isolatedIds.has(selected.id) ? <Badge variant="secondary">No incoming links</Badge> : null}
                  {scope === 'neighborhood' && focusId === selected.id ? <Badge variant="secondary">Center</Badge> : null}
                  {selected.distance !== undefined && selected.distance > 0 ? <Badge variant="outline">{selected.distance} {selected.distance === 1 ? 'hop' : 'hops'}</Badge> : null}
                </div>
                <h2 className="truncate text-sm font-semibold" title={selected.title}>{selected.title}</h2>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{selected.path}</p>
                <p className="mt-2 text-xs text-muted-foreground">{degreeOf(selected.id)} connections · {connections.incoming.filter((edge) => edge.sourceId !== edge.targetId).length} incoming · {connections.outgoing.filter((edge) => edge.sourceId !== edge.targetId).length} outgoing</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!selectedIsUnresolved ? <Button size="sm" onClick={() => onOpenNote(selected.id)}>Open note</Button> : null}
                {selected.unresolved !== true && selected.id !== focusId ? <Button size="sm" variant="outline" onClick={() => focusGraph(selected.id)}><Crosshair data-icon="inline-start" />Explore neighbors</Button> : null}
                {selected.unresolved !== true && selected.id === focusId ? <Button size="sm" variant="outline" onClick={centerView}><Focus data-icon="inline-start" />Center view</Button> : null}
              </div>
              <ConnectionList title={selectedIsUnresolved ? 'Referenced by' : 'Incoming links'} edges={connections.incoming.filter((edge) => edge.sourceId !== edge.targetId)} endpoint="sourceId" nodeById={nodeById} onSelect={(id) => selectNode(id, true)} />
              {selectedIsUnresolved ? null : <ConnectionList title="Outgoing links" edges={connections.outgoing.filter((edge) => edge.sourceId !== edge.targetId)} endpoint="targetId" nodeById={nodeById} onSelect={(id) => selectNode(id, true)} />}
              {connections.incoming.some((edge) => edge.sourceId === edge.targetId) ? <p className="border-t pt-2 text-[11px] text-muted-foreground">Self-links do not connect notes.</p> : null}
              {selectedIsUnresolved || graph === null ? null : <GraphPathExplorer vaultKey={vaultKey} source={selected} nodes={graph.nodes} mode={pathMode} onModeChange={setPathMode} onSelectNode={(id) => selectNode(id, true)} />}
            </> : null}
            {!selected && !selectedIsHidden ? <div className="text-sm text-muted-foreground">
              <p>Select a node to inspect its tags, path, and connections.</p>
              <p className="mt-2 text-xs">Double-click a note to open it. Use the arrow keys to move through nearby nodes.</p>
            </div> : null}
            <p id="graph-keyboard-help" className="sr-only">Use Tab to enter the graph, arrow keys to move between nodes, Enter or Space to select, Control or Command plus Enter to open, plus and minus to zoom, zero or F to fit, and Escape to clear the selection.</p>
          </aside>
        </div>
      </> : null}
    </div>
  </section>;
}

function nodeRadius(node: DisplayGraphNode, degree: number, visualScale: number): number {
  const base = node.unresolved === true ? 8 : node.distance === 0 ? 14 : Math.min(13, 9 + Math.log2(degree + 1) * 1.2);
  return Math.min(19, Math.max(base, 5.2 / Math.max(visualScale, 0.01)));
}

function labelFor(title: string): string {
  const characters = Array.from(title);
  return characters.length > 24 ? `${characters.slice(0, 23).join('')}…` : title;
}

function GraphContextMenu({ menu, node, centerId, onOpenNote, onSetCenter, onReveal, onClear, onClose }: {
  menu: ContextMenuState;
  node: DisplayGraphNode | null;
  centerId: string | null;
  onOpenNote: (id: string) => void;
  onSetCenter: (id: string) => void;
  onReveal: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  if (node === null) return null;
  return <div data-graph-context-menu role="menu" aria-label={`Actions for ${node.title}`} className="nodus-graph-context-menu" style={{ left: menu.x, top: menu.y }}>
    {node.unresolved !== true ? <button ref={ref} type="button" role="menuitem" className="nodus-graph-context-item" onClick={() => { onOpenNote(node.id); onClose(); }}><ExternalLink className="size-3.5" aria-hidden="true" />Open note</button> : <button ref={ref} type="button" role="menuitem" className="nodus-graph-context-item" onClick={onClose}>Close</button>}
    {node.unresolved !== true ? <button type="button" role="menuitem" className="nodus-graph-context-item" onClick={() => onSetCenter(node.id)}><Crosshair className="size-3.5" aria-hidden="true" />{centerId === node.id ? 'Keep as center' : 'Set as center'}</button> : null}
    <button type="button" role="menuitem" className="nodus-graph-context-item" onClick={() => onReveal(node.id)}><Focus className="size-3.5" aria-hidden="true" />Reveal on canvas</button>
    <button type="button" role="menuitem" className="nodus-graph-context-item" onClick={onClear}><X className="size-3.5" aria-hidden="true" />Clear selection</button>
  </div>;
}

function ConnectionList({ title, edges, endpoint, nodeById, onSelect }: { title: string; edges: GraphEdge[]; endpoint: 'sourceId' | 'targetId'; nodeById: Map<string, { id: string; title: string; path: string }>; onSelect: (id: string) => void }) {
  return <section className="flex min-h-0 flex-col gap-1" aria-label={title}>
    <h3 className="text-xs font-medium">{title} ({edges.length})</h3>
    {edges.length === 0 ? <p className="text-xs text-muted-foreground">No {title.toLowerCase()}.</p> : <ul className="max-h-40 overflow-auto">
      {edges.map((edge) => {
        const id = edge[endpoint];
        const node = nodeById.get(id);
        if (!node) return null;
        return <li key={`${edge.sourceId}:${edge.targetId}`}>
          <Button variant="ghost" size="sm" className="h-auto w-full justify-start gap-1 px-1.5 py-1 text-left" onClick={() => onSelect(id)} title={node.path}>
            <span className="min-w-0 flex-1 truncate">{node.title}</span>
            {edge.linkCount > 1 ? <Badge variant="secondary">×{edge.linkCount}</Badge> : null}
          </Button>
          {edge.snippets[0] ? <p className="line-clamp-2 px-1.5 pb-1 text-[10px] leading-4 text-muted-foreground">{edge.snippets[0]}</p> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
