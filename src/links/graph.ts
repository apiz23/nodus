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

export interface GraphUnresolvedLink {
  sourceId: string;
  /** Literal unresolved wiki-link target, preserved for exploration. */
  target: string;
  linkCount: number;
  snippets: string[];
}

export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedLinks?: GraphUnresolvedLink[];
  unresolvedCount: number;
  ambiguousCount: number;
  /** Note IDs with no confirmed incoming or outgoing links; self-links do not connect. */
  isolatedNodeIds?: string[];
}

/** Project only confirmed resolved links; the shared link snapshot remains the source of truth. */
export function graphFromLinkIndex(index: LinkIndex): NoteGraph {
  const nodes = index.notes.map(({ id, title, path }) => ({ id, title, path }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgesByPair = new Map<string, GraphEdge>();
  const unresolvedByPair = new Map<string, GraphUnresolvedLink>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
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
      if (nodeIds.has(link.sourceId)) {
        const key = `${link.sourceId}\0${link.target}`;
        const unresolved = unresolvedByPair.get(key);
        if (unresolved) {
          unresolved.linkCount++;
          if (unresolved.snippets.length < 3 && !unresolved.snippets.includes(link.snippet)) unresolved.snippets.push(link.snippet);
        } else {
          unresolvedByPair.set(key, {
            sourceId: link.sourceId,
            target: link.target,
            linkCount: 1,
            snippets: [link.snippet],
          });
        }
      }
      continue;
    }
    const targetId = link.resolution.noteId;
    if (targetId !== link.sourceId) {
      incoming.add(targetId);
      outgoing.add(link.sourceId);
    }
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
  const unresolvedLinks = [...unresolvedByPair.values()]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.target.localeCompare(b.target));
  return {
    nodes,
    edges,
    unresolvedLinks,
    unresolvedCount,
    ambiguousCount,
    isolatedNodeIds: nodes
      .filter((node) => !incoming.has(node.id) && !outgoing.has(node.id))
      .map((node) => node.id),
  };
}
