import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Minus, Network, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { GraphEdge } from '../../src/links/graph.js';
import type { UiGraphCluster, UiNoteGraph } from '../../src/ui-server/dto.js';
import type { GraphTraversalMode } from '../../src/links/graph-paths.js';
import { DEFAULT_GRAPH_RENDER_LIMIT, type SavedGraphViewConfig } from './graph-saved-views';
import { GraphSavedViews } from './GraphSavedViews';
import { GraphPathExplorer } from './GraphPathExplorer';
import { GraphClusterInsights } from './GraphClusterInsights';
import { api } from './api';
import { graphConnections, graphFolders, positionGraph, visibleGraph } from './graph-model';
import { cn } from '@/lib/utils';

interface Props { revision: number; initialNoteId: string | null; vaultKey: string; onOpenNote: (id: string) => void }
interface Viewport { x: number; y: number; scale: number }
const ALL_FOLDERS = '__all__';
const ALL_CLUSTERS = '__all__';
const ISOLATED_CLUSTER = '__isolated__';

export function GraphView({ revision, initialNoteId, vaultKey, onOpenNote }: Props) {
  const [graph, setGraph] = useState<UiNoteGraph | null>(null);
  const [clusters, setClusters] = useState<UiGraphCluster[]>([]);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [showIsolated, setShowIsolated] = useState(true);
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusHistory, setFocusHistory] = useState<string[]>([]);
  const [pathMode, setPathMode] = useState<GraphTraversalMode>('directed');
  const [renderLimit, setRenderLimit] = useState(DEFAULT_GRAPH_RENDER_LIMIT);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const request = useRef(0);
  const mounted = useRef(true);
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

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
    } catch (reason) {
      if (mounted.current && current === request.current) setError(reason instanceof Error ? reason.message : 'Could not load the local note graph.');
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current++; drag.current = null; };
  }, [revision]);

  const folders = useMemo(() => graphFolders(graph?.nodes ?? []), [graph]);
  const selectedCluster = clusterId === ISOLATED_CLUSTER
    ? null
    : clusters.find((cluster) => cluster.id === clusterId) ?? null;
  const clusterNodeIds = useMemo(() => {
    if (clusterId === null) return null;
    if (clusterId === ISOLATED_CLUSTER) return new Set(graph?.isolatedNodeIds ?? []);
    return new Set(selectedCluster?.members.map((member) => member.id) ?? []);
  }, [clusterId, selectedCluster, graph]);
  const visible = useMemo(
    () => graph ? visibleGraph(graph, query, focusId, renderLimit, { folder, showIsolated, showUnresolved, clusterNodeIds, priorityIds: selectedCluster?.members.map((member) => member.id) }) : null,
    [graph, query, focusId, folder, showIsolated, showUnresolved, clusterNodeIds, renderLimit, selectedCluster],
  );
  const positions = useMemo(() => visible ? positionGraph(visible.nodes, focusId) : [], [visible, focusId]);
  const positionsById = useMemo(() => new Map(positions.map((node) => [node.id, node])), [positions]);
  const selected = visible?.nodes.find((node) => node.id === selectedId) ?? null;
  const connections = useMemo(
    () => visible && selected ? graphConnections(visible.edges, selected.id) : { incoming: [], outgoing: [] },
    [visible, selected],
  );
  const neighborIds = useMemo(() => new Set([
    ...(selected ? [selected.id] : []),
    ...connections.incoming.map((edge) => edge.sourceId),
    ...connections.outgoing.map((edge) => edge.targetId),
  ]), [selected, connections]);
  const nodeById = useMemo(() => new Map(visible?.nodes.map((node) => [node.id, node]) ?? []), [visible]);

  function selectNode(id: string) { setSelectedId(id); }
  function zoom(factor: number) { setViewport((current) => ({ ...current, scale: Math.max(0.5, Math.min(2.5, current.scale * factor)) })); }
  function resetViewport() { setViewport({ x: 0, y: 0, scale: 1 }); }
  function focusGraph(id: string) {
    if (focusId !== null && focusId !== id) setFocusHistory((history) => [...history.slice(-9), focusId]);
    setFocusId(id);
    setSelectedId(id);
    resetViewport();
  }
  function clearFocus() {
    if (focusId !== null) setFocusHistory((history) => [...history.slice(-9), focusId]);
    setFocusId(null);
    resetViewport();
  }
  function backFocus() {
    const previous = focusHistory.at(-1) ?? null;
    setFocusHistory((history) => history.slice(0, -1));
    setFocusId(previous);
    if (previous !== null) setSelectedId(previous);
    resetViewport();
  }
  function resetFilters() {
    setQuery('');
    setFolder(null);
    setClusterId(null);
    setShowIsolated(true);
    setShowUnresolved(true);
    setFocusId(null);
    setFocusHistory([]);
    setSelectedId(null);
    setPathMode('directed');
    setRenderLimit(DEFAULT_GRAPH_RENDER_LIMIT);
    resetViewport();
  }
  function captureConfig(): SavedGraphViewConfig {
    return { query, folder, clusterId, focusId, selectedId, showIsolated, showUnresolved, pathMode, viewport, renderLimit };
  }
  function applySavedConfig(config: SavedGraphViewConfig) {
    setQuery(config.query);
    setFolder(config.folder);
    setClusterId(config.clusterId === null || config.clusterId === ISOLATED_CLUSTER || clusters.some((cluster) => cluster.id === config.clusterId && cluster.size > 1) ? config.clusterId : null);
    setShowIsolated(config.showIsolated);
    setShowUnresolved(config.showUnresolved);
    setPathMode(config.pathMode);
    setRenderLimit(config.renderLimit);
    setViewport(config.viewport);
    setFocusHistory([]);
    const existing = new Set(graph?.nodes.map((node) => node.id) ?? []);
    setFocusId(config.focusId !== null && existing.has(config.focusId) ? config.focusId : null);
    setSelectedId(config.selectedId !== null && existing.has(config.selectedId) ? config.selectedId : null);
  }
  function edgePath(edge: GraphEdge) {
    const source = positionsById.get(edge.sourceId), target = positionsById.get(edge.targetId);
    if (!source || !target) return '';
    if (source.id === target.id) return `M ${source.x - 8} ${source.y - 17} C ${source.x - 65} ${source.y - 88}, ${source.x + 65} ${source.y - 88}, ${source.x + 8} ${source.y - 17}`;
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  const selectedIsUnresolved = selected?.unresolved === true;

  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Local note graph">
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
      <Network className="size-4 text-muted-foreground" aria-hidden="true" />
      <h1 className="flex-1 text-sm font-medium">Local graph</h1>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" />Refresh from disk</Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="graph-filter">Filter notes by title or path</label>
        <Input id="graph-filter" type="search" className="min-w-48 flex-1 sm:max-w-xs" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Filter notes by title or path" />
        <Select value={folder ?? ALL_FOLDERS} onValueChange={(value) => setFolder(value === ALL_FOLDERS ? null : value)}>
          <SelectTrigger className="w-44" aria-label="Filter by folder">
            <SelectValue placeholder="All folders" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FOLDERS}>All folders</SelectItem>
            {folders.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clusterId ?? ALL_CLUSTERS} onValueChange={(value) => { setClusterId(value === ALL_CLUSTERS ? null : value); setSelectedId(null); setFocusId(null); setFocusHistory([]); }}>
          <SelectTrigger className="w-52" aria-label="Filter by knowledge cluster">
            <SelectValue placeholder="All clusters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLUSTERS}>All clusters</SelectItem>
            {graph?.isolatedNodeIds?.length ? <SelectItem value={ISOLATED_CLUSTER}>Isolated notes ({graph.isolatedNodeIds.length})</SelectItem> : null}
            {clusters.filter((cluster) => cluster.size > 1).map((cluster) => (
              <SelectItem key={cluster.id} value={cluster.id}>{cluster.representative.title} · {cluster.size} notes</SelectItem>
            ))}
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
        <Button variant="outline" size="sm" onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus /></Button>
        <Button variant="outline" size="sm" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus /></Button>
        <Select value={String(renderLimit)} onValueChange={(value) => setRenderLimit(Number(value))}>
          <SelectTrigger className="w-32" aria-label="Graph render limit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="100">100 nodes</SelectItem>
            <SelectItem value="200">200 nodes</SelectItem>
            <SelectItem value="400">400 nodes</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={resetViewport}><RotateCcw data-icon="inline-start" />Reset viewport</Button>
        <Button variant="ghost" size="sm" onClick={resetFilters}>Reset filters</Button>
        {focusHistory.length > 0 ? <Button variant="ghost" size="sm" onClick={backFocus}><ArrowLeft data-icon="inline-start" />Previous focus</Button> : null}
        {focusId ? <Button variant="ghost" size="sm" onClick={clearFocus}>Show full graph</Button> : null}
      </div>

      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button></div> : null}
      {loading && graph === null ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading note graph…</p> : null}
      {!loading && !error && graph?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-12 text-center"><h2 className="font-medium">No notes to map yet</h2><p className="mt-1 text-sm text-muted-foreground">Create Markdown notes and connect them with wiki links such as [[Note title]].</p></div> : null}
      {graph && graph.nodes.length > 0 && visible?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-10 text-center"><h2 className="font-medium">No matching notes</h2><p className="mt-1 text-sm text-muted-foreground">Try another title, folder, or filter.</p></div> : null}

      {graph && visible && visible.nodes.length > 0 ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>{visible.noteCount} of {graph.nodes.length} notes shown</span>
          <span>{visible.edges.filter((edge) => edge.unresolved !== true).length} confirmed links shown · {graph.edges.length} total</span>
          {visible.unresolvedCount > 0 ? <Badge variant="secondary">{visible.unresolvedCount} unresolved targets shown</Badge> : null}
          {graph.unresolvedCount ? <Badge variant="secondary">{graph.unresolvedCount} unresolved excluded</Badge> : null}
          {graph.ambiguousCount ? <Badge variant="secondary">{graph.ambiguousCount} ambiguous occurrences excluded</Badge> : null}
          {visible.truncated ? <span>Showing the first {renderLimit}; filter, focus, or reduce the render limit to explore more.</span> : null}
          {clusterError ? <span role="alert" className="text-destructive">Cluster filter unavailable: {clusterError}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <GraphSavedViews vaultKey={vaultKey} references={{ noteIds: new Set(graph?.nodes.map((node) => node.id) ?? []), folderPaths: new Set(folders), clusterIds: new Set(clusters.filter((cluster) => cluster.size > 1).map((cluster) => cluster.id)) }} captureConfig={captureConfig} onApply={applySavedConfig} />
        </div>
        {clusterId === null ? null : <GraphClusterInsights clusterId={clusterId} isolatedCount={graph?.isolatedNodeIds?.length ?? 0} onSelectNode={selectNode} onOpenNote={onOpenNote} />}
        <div className="grid min-h-[26rem] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-h-[24rem] overflow-hidden rounded-md border bg-card">
            <svg viewBox="0 0 1000 640" role="group" aria-label="Directed wiki-link graph" className="size-full min-h-[24rem] touch-none select-none"
              onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08); }}
              onPointerDown={(event) => { if ((event.target as Element).closest('[data-graph-node]')) return; drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { const active = drag.current; if (!active || active.pointerId !== event.pointerId) return; const bounds = event.currentTarget.getBoundingClientRect(); setViewport((current) => ({ ...current, x: active.originX + (event.clientX - active.x) * 1000 / Math.max(1, bounds.width), y: active.originY + (event.clientY - active.y) * 640 / Math.max(1, bounds.height) })); }}
              onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}>
              <defs><marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,7 L7,3.5 z" className="fill-muted-foreground" /></marker></defs>
              <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
                {visible.edges.map((edge) => {
                  const active = selectedId !== null && (edge.sourceId === selectedId || edge.targetId === selectedId);
                  return <path
                    key={`${edge.sourceId}:${edge.targetId}`}
                    d={edgePath(edge)}
                    fill="none"
                    className={cn(
                      edge.unresolved ? 'stroke-muted-foreground/50 [stroke-dasharray:5_4]' : 'stroke-muted-foreground/45',
                      active ? 'stroke-success' : selectedId !== null ? 'opacity-20' : undefined,
                    )}
                    strokeWidth={Math.min(4, 1 + Math.log2(edge.linkCount))}
                    markerEnd={edge.unresolved ? undefined : 'url(#graph-arrow)'}
                  >
                    <title>{nodeById.get(edge.sourceId)?.title} links to {nodeById.get(edge.targetId)?.title}{edge.linkCount > 1 ? ` (${edge.linkCount} wiki links)` : ''}{edge.snippets[0] ? `: ${edge.snippets[0]}` : ''}</title>
                  </path>;
                })}
                {positions.map((node) => {
                  const nodeSelected = selectedId === node.id;
                  const neighbor = neighborIds.has(node.id);
                  return <g
                    key={node.id}
                    data-graph-node="true"
                    data-unresolved={node.unresolved === true ? 'true' : undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={node.unresolved === true ? `Select unresolved target ${node.title}` : `Select ${node.title}`}
                    aria-pressed={nodeSelected}
                    onClick={() => selectNode(node.id)}
                    onDoubleClick={() => { if (node.unresolved !== true) onOpenNote(node.id); }}
                    onFocus={() => setFocusedId(node.id)}
                    onBlur={() => setFocusedId(null)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } }}
                    className="cursor-pointer outline-none"
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.id === focusId ? 12 : node.unresolved === true ? 7 : 9}
                      strokeDasharray={node.unresolved === true ? '3 3' : undefined}
                      className={nodeSelected ? 'fill-primary stroke-ring' : neighbor && selectedId !== null ? 'fill-secondary stroke-success' : node.id === focusedId ? 'fill-secondary stroke-ring' : 'fill-secondary stroke-border'}
                      strokeWidth={node.id === focusedId ? 4 : 2}
                    />
                    <text x={node.x} y={node.y + 25} textAnchor="middle" className={cn('fill-foreground text-[12px]', selectedId !== null && !neighbor && 'opacity-40')}>{labelFor(node.title)}</text>
                    <title>{node.unresolved === true ? `Unresolved target: ${node.title}` : `${node.title} · ${node.path} (double-click to open)`}</title>
                  </g>;
                })}
              </g>
            </svg>
          </div>
          <aside className="flex min-h-0 flex-col gap-3 rounded-md border p-3" aria-label="Selected note connections">
            {selected ? <>
              <div className="min-w-0">
                {selectedIsUnresolved ? <Badge variant="outline" className="mb-1">Unresolved target</Badge> : null}
                <h2 className="truncate text-sm font-semibold" title={selected.title}>{selected.title}</h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">{selected.path}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!selectedIsUnresolved ? <Button size="sm" onClick={() => onOpenNote(selected.id)}>Open note</Button> : null}
                <Button size="sm" variant="outline" onClick={() => focusGraph(selected.id)}>Explore neighbors</Button>
              </div>
              <ConnectionList title={selectedIsUnresolved ? 'Referenced by' : 'Incoming links'} edges={connections.incoming} endpoint="sourceId" nodeById={nodeById} onSelect={selectNode} />
              {selectedIsUnresolved ? null : <ConnectionList title="Outgoing links" edges={connections.outgoing} endpoint="targetId" nodeById={nodeById} onSelect={selectNode} />}
              {selectedIsUnresolved || graph === null ? null : <GraphPathExplorer vaultKey={vaultKey} source={selected} nodes={graph.nodes} mode={pathMode} onModeChange={setPathMode} onSelectNode={selectNode} />}
            </> : <p className="text-sm text-muted-foreground">Select a note node to inspect its incoming and outgoing links. Unresolved targets are shown as dashed nodes.</p>}
          </aside>
        </div>
      </> : null}
    </div>
  </section>;
}

function labelFor(title: string): string {
  const characters = Array.from(title);
  return characters.length > 24 ? `${characters.slice(0, 23).join('')}…` : title;
}

function ConnectionList({ title, edges, endpoint, nodeById, onSelect }: { title: string; edges: GraphEdge[]; endpoint: 'sourceId' | 'targetId'; nodeById: Map<string, { id: string; title: string; path: string }>; onSelect: (id: string) => void }) {
  return <section className="flex min-h-0 flex-col gap-1" aria-label={title}>
    <h3 className="text-xs font-medium">{title} ({edges.length})</h3>
    {edges.length === 0 ? <p className="text-xs text-muted-foreground">No {title.toLowerCase()}.</p> : <ul className="max-h-32 overflow-auto">
      {edges.map((edge) => { const id = edge[endpoint]; const node = nodeById.get(id); if (!node) return null; return <li key={`${edge.sourceId}:${edge.targetId}`}>
        <Button variant="link" size="sm" className="h-auto max-w-full justify-start gap-1 px-0 py-0.5 text-left" onClick={() => onSelect(id)} title={node.path}>{node.title}{edge.linkCount > 1 ? <Badge variant="secondary">×{edge.linkCount}</Badge> : null}</Button>
      </li>; })}
    </ul>}
  </section>;
}
