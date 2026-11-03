import type { GraphEdge, GraphNode, NoteGraph } from './graph.js';

export type GraphTraversalMode = 'directed' | 'undirected';
export type GraphPathStatus = 'found' | 'same-node' | 'missing' | 'disconnected' | 'limit';

export interface GraphPathResult {
  status: GraphPathStatus;
  mode: GraphTraversalMode;
  fromId: string;
  toId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  visited: number;
  maxDepth: number;
  maxVisited: number;
}

export interface GraphPathOptions {
  /** directed follows wiki-link source -> target; undirected follows either direction. */
  mode?: GraphTraversalMode;
  maxDepth?: number;
  maxVisited?: number;
}

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_VISITED = 5_000;

/**
 * BFS shortest path over confirmed resolved edges. Self-links never advance a
 * path. Ties are broken by target title, path, and stable ID, so repeated calls
 * return the same shortest path.
 */
export function shortestGraphPath(graph: NoteGraph, fromId: string, toId: string, options: GraphPathOptions = {}): GraphPathResult {
  const mode = options.mode ?? 'directed';
  const maxDepth = clamp(options.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 100);
  const maxVisited = clamp(options.maxVisited ?? DEFAULT_MAX_VISITED, 1, 50_000);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (from === undefined || to === undefined) {
    return { status: 'missing', mode, fromId, toId, nodes: [], edges: [], visited: 0, maxDepth, maxVisited };
  }
  if (fromId === toId) {
    return { status: 'same-node', mode, fromId, toId, nodes: [from], edges: [], visited: 1, maxDepth, maxVisited };
  }

  const adjacency = new Map<string, Array<{ nextId: string; edge: GraphEdge }>>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (edge.sourceId === edge.targetId || !byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    adjacency.get(edge.sourceId)!.push({ nextId: edge.targetId, edge });
    if (mode === 'undirected') adjacency.get(edge.targetId)!.push({ nextId: edge.sourceId, edge });
  }
  for (const entries of adjacency.values()) {
    entries.sort((left, right) => {
      const a = byId.get(left.nextId);
      const b = byId.get(right.nextId);
      return (a?.title ?? '').localeCompare(b?.title ?? '')
        || (a?.path ?? '').localeCompare(b?.path ?? '')
        || left.nextId.localeCompare(right.nextId);
    });
  }

  const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, { previousId: string; edge: GraphEdge }>();
  let cursor = 0;
  let visitedCount = 1;
  let reachedLimit = false;

  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    if (current.depth >= maxDepth) {
      reachedLimit = true;
      continue;
    }
    for (const { nextId, edge } of adjacency.get(current.id) ?? []) {
      if (visited.has(nextId)) continue;
      if (visitedCount >= maxVisited) {
        reachedLimit = true;
        break;
      }
      visited.add(nextId);
      visitedCount += 1;
      parent.set(nextId, { previousId: current.id, edge });
      if (nextId === toId) return resultFromParents(parent, byId, from, to, mode, visitedCount, maxDepth, maxVisited);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
    if (reachedLimit) break;
  }

  return {
    status: reachedLimit ? 'limit' : 'disconnected',
    mode, fromId, toId, nodes: [], edges: [], visited: visitedCount, maxDepth, maxVisited,
  };
}

function resultFromParents(
  parent: Map<string, { previousId: string; edge: GraphEdge }>,
  byId: Map<string, GraphNode>,
  from: GraphNode,
  to: GraphNode,
  mode: GraphTraversalMode,
  visited: number,
  maxDepth: number,
  maxVisited: number,
): GraphPathResult {
  const nodes = [to];
  const edges: GraphEdge[] = [];
  let current = to.id;
  while (current !== from.id) {
    const step = parent.get(current);
    if (step === undefined) break;
    edges.push(step.edge);
    nodes.push(byId.get(step.previousId)!);
    current = step.previousId;
  }
  nodes.reverse();
  edges.reverse();
  return { status: 'found', mode, fromId: from.id, toId: to.id, nodes, edges, visited, maxDepth, maxVisited };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
