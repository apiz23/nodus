import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Network, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GraphEdge } from '../../src/links/graph.js';
import type { UiNoteGraph } from '../../src/ui-server/dto.js';
import { api } from './api';
import { graphConnections, positionGraph, visibleGraph } from './graph-model';

interface Props { revision: number; initialNoteId: string | null; onOpenNote: (id: string) => void }
interface Viewport { x: number; y: number; scale: number }
const GRAPH_NODE_LIMIT = 200;

export function GraphView({ revision, initialNoteId, onOpenNote }: Props) {
  const [graph, setGraph] = useState<UiNoteGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const request = useRef(0);
  const mounted = useRef(true);
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.graph(refresh);
      if (!mounted.current || current !== request.current) return;
      setGraph(result);
      setSelectedId((id) => id && result.nodes.some((node) => node.id === id) ? id : null);
      setFocusId((id) => id && result.nodes.some((node) => node.id === id) ? id : null);
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

  const visible = useMemo(() => graph ? visibleGraph(graph, query, focusId, GRAPH_NODE_LIMIT) : null, [graph, query, focusId]);
  const positions = useMemo(() => visible ? positionGraph(visible.nodes, focusId) : [], [visible, focusId]);
  const positionsById = useMemo(() => new Map(positions.map((node) => [node.id, node])), [positions]);
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const connections = useMemo(() => graph && selected ? graphConnections(graph.edges, selected.id) : { incoming: [], outgoing: [] }, [graph, selected]);
  const nodeById = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []), [graph]);

  function selectNode(id: string) { setSelectedId(id); }
  function zoom(factor: number) { setViewport((current) => ({ ...current, scale: Math.max(0.5, Math.min(2.5, current.scale * factor)) })); }
  function resetViewport() { setViewport({ x: 0, y: 0, scale: 1 }); }
  function edgePath(edge: GraphEdge) {
    const source = positionsById.get(edge.sourceId), target = positionsById.get(edge.targetId);
    if (!source || !target) return '';
    if (source.id === target.id) return `M ${source.x - 8} ${source.y - 17} C ${source.x - 65} ${source.y - 88}, ${source.x + 65} ${source.y - 88}, ${source.x + 8} ${source.y - 17}`;
    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  }

  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Local note graph">
    <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
      <Network className="size-4 text-muted-foreground" aria-hidden="true" />
      <h1 className="flex-1 text-sm font-medium">Local graph</h1>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" />Refresh from disk</Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="graph-filter">Filter notes by title or path</label>
        <Input id="graph-filter" type="search" className="min-w-48 flex-1 sm:max-w-sm" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Filter notes by title or path" />
        <Button variant="outline" size="sm" onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus /></Button>
        <Button variant="outline" size="sm" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus /></Button>
        <Button variant="outline" size="sm" onClick={resetViewport}><RotateCcw data-icon="inline-start" />Reset viewport</Button>
        {focusId ? <Button variant="ghost" size="sm" onClick={() => setFocusId(null)}>Show full graph</Button> : null}
      </div>

      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button></div> : null}
      {loading && graph === null ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading note graph…</p> : null}
      {!loading && !error && graph?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-12 text-center"><h2 className="font-medium">No notes to map yet</h2><p className="mt-1 text-sm text-muted-foreground">Create Markdown notes and connect them with wiki links such as [[Note title]].</p></div> : null}
      {graph && graph.nodes.length > 0 && visible?.nodes.length === 0 ? <div className="rounded-md border border-dashed px-4 py-10 text-center"><h2 className="font-medium">No matching notes</h2><p className="mt-1 text-sm text-muted-foreground">Try another title or path.</p></div> : null}

      {graph && visible && visible.nodes.length > 0 ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>{visible.nodes.length} of {graph.nodes.length} notes shown</span><span>{visible.edges.length} links shown · {graph.edges.length} confirmed links total</span>
          {graph.unresolvedCount ? <Badge variant="secondary">{graph.unresolvedCount} unresolved excluded</Badge> : null}
          {graph.ambiguousCount ? <Badge variant="secondary">{graph.ambiguousCount} ambiguous excluded</Badge> : null}
          {visible.truncated ? <span>Showing the first {GRAPH_NODE_LIMIT}; filter or focus a note to explore more.</span> : null}
        </div>
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
                {visible.edges.map((edge) => <path key={`${edge.sourceId}:${edge.targetId}`} d={edgePath(edge)} fill="none" className="stroke-muted-foreground/45" strokeWidth={Math.min(4, 1 + Math.log2(edge.linkCount))} markerEnd="url(#graph-arrow)"><title>{nodeById.get(edge.sourceId)?.title} links to {nodeById.get(edge.targetId)?.title}{edge.linkCount > 1 ? ` (${edge.linkCount} wiki links)` : ''}{edge.snippets[0] ? `: ${edge.snippets[0]}` : ''}</title></path>)}
                {positions.map((node) => <g key={node.id} data-graph-node="true" role="button" tabIndex={0} aria-label={`Select ${node.title}`} aria-pressed={selectedId === node.id} onClick={() => selectNode(node.id)} onFocus={() => setFocusedId(node.id)} onBlur={() => setFocusedId(null)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } }} className="cursor-pointer outline-none">
                  <circle cx={node.x} cy={node.y} r={node.id === focusId ? 12 : 9} className={node.id === selectedId ? 'fill-primary stroke-ring' : node.id === focusedId ? 'fill-secondary stroke-ring' : 'fill-secondary stroke-border'} strokeWidth={node.id === focusedId ? 4 : 2} />
                  <text x={node.x} y={node.y + 25} textAnchor="middle" className="fill-foreground text-[12px]">{labelFor(node.title)}</text>
                  <title>{node.title} · {node.path}</title>
                </g>)}
              </g>
            </svg>
          </div>
          <aside className="flex min-h-0 flex-col gap-3 rounded-md border p-3" aria-label="Selected note connections">
            {selected ? <>
              <div className="min-w-0"><h2 className="truncate text-sm font-semibold" title={selected.title}>{selected.title}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{selected.path}</p></div>
              <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => onOpenNote(selected.id)}>Open note</Button><Button size="sm" variant="outline" onClick={() => { setFocusId(selected.id); resetViewport(); }}>Explore neighbors</Button></div>
              <ConnectionList title="Incoming links" edges={connections.incoming} endpoint="sourceId" nodeById={nodeById} onSelect={selectNode} />
              <ConnectionList title="Outgoing links" edges={connections.outgoing} endpoint="targetId" nodeById={nodeById} onSelect={selectNode} />
            </> : <p className="text-sm text-muted-foreground">Select a note node to inspect its incoming and outgoing links.</p>}
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
