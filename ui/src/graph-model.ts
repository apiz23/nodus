import type { GraphEdge, GraphNode, NoteGraph } from '../../src/links/graph.js';

export interface PositionedNode extends GraphNode { x: number; y: number; unresolved?: boolean }

export interface GraphFilterOptions {
  folder?: string | null;
  showIsolated?: boolean;
  showUnresolved?: boolean;
}

export interface DisplayGraphNode extends GraphNode {
  /** Virtual node representing an unresolved wiki-link target. */
  unresolved?: boolean;
}

export interface DisplayGraphEdge extends GraphEdge {
  unresolved?: boolean;
}

export interface VisibleGraph {
  nodes: DisplayGraphNode[];
  edges: DisplayGraphEdge[];
  total: number;
  truncated: boolean;
  noteCount: number;
  unresolvedCount: number;
}

function normalized(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase();
}

function folderOf(path: string): string {
  const normalizedPath = path.replaceAll('\\', '/');
  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '' : normalizedPath.slice(0, index);
}

/** All folders represented by graph nodes, sorted for the filter control. */
export function graphFolders(nodes: readonly GraphNode[]): string[] {
  return [...new Set(nodes.map((node) => folderOf(node.path)).filter((folder) => folder !== ''))]
    .sort((left, right) => left.localeCompare(right));
}

function matchesFolder(path: string, folder: string): boolean {
  if (folder === '') return true;
  const normalizedPath = path.replaceAll('\\', '/');
  return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
}

function unresolvedNodeId(target: string): string {
  return `unresolved:${normalized(target)}`;
}

/**
 * Apply presentation-only filters to a derived graph. This never mutates the
 * graph or note data. Unresolved links become virtual dashed nodes when shown;
 * all other nodes use stable note IDs.
 */
export function visibleGraph(
  graph: NoteGraph,
  query: string,
  focusId: string | null,
  limit = 200,
  options: GraphFilterOptions = {},
): VisibleGraph {
  const normalizedQuery = normalized(query);
  const folder = options.folder?.replace(/\/+$/, '') ?? '';
  const showIsolated = options.showIsolated !== false;
  const showUnresolved = options.showUnresolved !== false;
  const isolated = new Set(graph.isolatedNodeIds ?? []);

  const matchingNotes = graph.nodes.filter((node) => {
    if (!matchesFolder(node.path, folder)) return false;
    if (!normalizedQuery) return true;
    return normalized(`${node.title}\n${node.path}`).includes(normalizedQuery);
  });
  const noteCandidates = showIsolated
    ? matchingNotes
    : matchingNotes.filter((node) => !isolated.has(node.id));
  const nodes: DisplayGraphNode[] = noteCandidates.map((node) => ({ ...node }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: DisplayGraphEdge[] = graph.edges
    .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
    .map((edge) => ({ ...edge }));

  if (showUnresolved) {
    for (const link of graph.unresolvedLinks ?? []) {
      if (!nodeIds.has(link.sourceId)) continue;
      if (normalizedQuery && !normalized(link.target).includes(normalizedQuery)
        && !normalized(`${link.sourceId}\n${link.target}`).includes(normalizedQuery)) {
        // The source may already match the query; unresolved targets are still
        // useful context in that case. Only skip when neither side matches.
        const source = nodes.find((node) => node.id === link.sourceId);
        if (source === undefined || !normalized(`${source.title}\n${source.path}`).includes(normalizedQuery)) continue;
      }
      const id = unresolvedNodeId(link.target);
      if (!nodeIds.has(id)) {
        nodeIds.add(id);
        nodes.push({ id, title: link.target, path: 'Unresolved target', unresolved: true });
      }
      edges.push({
        sourceId: link.sourceId,
        targetId: id,
        linkCount: link.linkCount,
        snippets: link.snippets,
        unresolved: true,
      });
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  let candidates = nodes;
  if (focusId && (byId.has(focusId) || graph.nodes.some((node) => node.id === focusId))) {
    const connected = new Set([focusId]);
    for (const edge of edges) {
      if (edge.sourceId === focusId) connected.add(edge.targetId);
      if (edge.targetId === focusId) connected.add(edge.sourceId);
    }
    candidates = nodes.filter((node) => connected.has(node.id));
    if (!candidates.some((node) => node.id === focusId)) {
      const focused = graph.nodes.find((node) => node.id === focusId);
      if (focused) candidates = [{ ...focused }, ...candidates];
    }
  }

  const unique = [...new Map(candidates.map((node) => [node.id, node])).values()];
  if (focusId) {
    unique.sort((left, right) => left.id === focusId ? -1 : right.id === focusId ? 1
      : Number(left.unresolved === true) - Number(right.unresolved === true)
        || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  } else {
    unique.sort((left, right) => Number(left.unresolved === true) - Number(right.unresolved === true)
      || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }
  const limited = unique.slice(0, limit);
  const ids = new Set(limited.map((node) => node.id));
  return {
    nodes: limited,
    edges: edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)),
    total: unique.length,
    truncated: unique.length > limited.length,
    noteCount: limited.filter((node) => node.unresolved !== true).length,
    unresolvedCount: limited.filter((node) => node.unresolved === true).length,
  };
}

export function graphConnections(edges: readonly GraphEdge[], noteId: string) {
  const incoming = edges.filter((edge) => edge.targetId === noteId).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const outgoing = edges.filter((edge) => edge.sourceId === noteId).sort((a, b) => a.targetId.localeCompare(b.targetId));
  return { incoming, outgoing };
}

export function positionGraph(nodes: readonly GraphNode[], focusId: string | null, width = 1000, height = 640): PositionedNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(100, Math.min(width, height) * 0.38);
  return nodes.map((node, index) => {
    if (node.id === focusId) return { ...node, x: centerX, y: centerY };
    const ringIndex = focusId ? index - 1 : index;
    const count = Math.max(1, nodes.length - (focusId && nodes.some((item) => item.id === focusId) ? 1 : 0));
    const angle = (2 * Math.PI * ringIndex) / count - Math.PI / 2;
    return { ...node, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
}
