import type { LinkIndex } from './link-index.js';

export interface GraphNode {
  id: string;
  title: string;
  path: string;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  /** Repeated wiki links are represented by one edge with their count. */
  linkCount: number;
  snippets: string[];
}

export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedCount: number;
  ambiguousCount: number;
}

/** Project only confirmed resolved links; the shared link snapshot remains the source of truth. */
export function graphFromLinkIndex(index: LinkIndex): NoteGraph {
  const nodes = index.notes.map(({ id, title, path }) => ({ id, title, path }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgesByPair = new Map<string, GraphEdge>();
  let unresolvedCount = 0;
  let ambiguousCount = 0;

  for (const link of index.links) {
    if (link.resolution.status === 'ambiguous') {
      ambiguousCount++;
      continue;
    }
    if (link.resolution.status === 'unresolved' || !nodeIds.has(link.sourceId)
      || !nodeIds.has(link.resolution.noteId)) {
      unresolvedCount++;
      continue;
    }
    const targetId = link.resolution.noteId;
    const key = `${link.sourceId}\0${targetId}`;
    const edge = edgesByPair.get(key);
    if (edge) {
      edge.linkCount++;
      if (edge.snippets.length < 3 && !edge.snippets.includes(link.snippet)) edge.snippets.push(link.snippet);
    } else {
      edgesByPair.set(key, { sourceId: link.sourceId, targetId, linkCount: 1, snippets: [link.snippet] });
    }
  }

  const edges = [...edgesByPair.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.targetId.localeCompare(b.targetId));
  return { nodes, edges, unresolvedCount, ambiguousCount };
}
