import type { GraphEdge, GraphNode, NoteGraph } from '../../src/links/graph.js';

export interface PositionedNode extends GraphNode { x: number; y: number }

export function visibleGraph(graph: NoteGraph, query: string, focusId: string | null, limit = 200) {
  const normalized = query.trim().normalize('NFC').toLocaleLowerCase();
  const matching = graph.nodes.filter((node) => !normalized || `${node.title}\n${node.path}`.normalize('NFC').toLocaleLowerCase().includes(normalized));
  const byId = new Map(matching.map((node) => [node.id, node]));
  let candidates = matching;
  if (focusId && graph.nodes.some((node) => node.id === focusId)) {
    const connected = new Set([focusId]);
    for (const edge of graph.edges) {
      if (edge.sourceId === focusId) connected.add(edge.targetId);
      if (edge.targetId === focusId) connected.add(edge.sourceId);
    }
    candidates = matching.filter((node) => connected.has(node.id));
    if (!byId.has(focusId)) {
      const focused = graph.nodes.find((node) => node.id === focusId);
      if (focused) candidates = [focused, ...candidates];
    }
  }
  const unique = [...new Map(candidates.map((node) => [node.id, node])).values()];
  if (focusId) unique.sort((a, b) => a.id === focusId ? -1 : b.id === focusId ? 1 : a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const nodes = unique.slice(0, limit);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
  return { nodes, edges, total: unique.length, truncated: unique.length > nodes.length };
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
