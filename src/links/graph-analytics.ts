import type { GraphNode, NoteGraph } from './graph.js';

export interface GraphNoteMetric {
  id: string;
  title: string;
  path: string;
  incoming: number;
  outgoing: number;
  degree: number;
  degreeCentrality: number;
}

export interface GraphComponentSummary {
  /** Stable, deterministic component key: the lexicographically smallest note ID. */
  id: string;
  size: number;
  totalDegree: number;
  representative: GraphNoteMetric;
  /** Sorted by degree descending, then title, path, and ID. */
  members: GraphNoteMetric[];
}

export interface GraphAnalytics {
  totalNotes: number;
  linkedNotes: number;
  isolatedNotes: number;
  unresolvedLinks: number;
  ambiguousLinks: number;
  selfLinkEdges: number;
  selfLinkOccurrences: number;
  componentCount: number;
  largestComponentSize: number;
  /** Sorted by degree descending, then title, path, and ID. */
  mostConnected: GraphNoteMetric[];
  /** All nodes sorted by title, path, and ID. */
  noteMetrics: GraphNoteMetric[];
  /** Components sorted by size descending, then representative title and component ID. */
  components: GraphComponentSummary[];
}

export interface GraphAnalyticsOptions {
  mostConnectedLimit?: number;
}

/**
 * Derive deterministic graph metrics from the existing projection.
 *
 * Degree uses distinct resolved neighbours, not duplicate link occurrences.
 * Self-links are counted separately and never add degree or component connectivity.
 * Components are weakly connected groups of notes; connectivity is not semantic similarity.
 */
export function analyzeGraph(graph: NoteGraph, options: GraphAnalyticsOptions = {}): GraphAnalytics {
  const limit = Math.max(0, options.mostConnectedLimit ?? 10);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const adjacency = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    incoming.set(node.id, new Set());
    outgoing.set(node.id, new Set());
    adjacency.set(node.id, new Set());
  }

  let selfLinkEdges = 0;
  let selfLinkOccurrences = 0;
  for (const edge of graph.edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    if (edge.sourceId === edge.targetId) {
      selfLinkEdges += 1;
      selfLinkOccurrences += edge.linkCount;
      continue;
    }
    outgoing.get(edge.sourceId)!.add(edge.targetId);
    incoming.get(edge.targetId)!.add(edge.sourceId);
    adjacency.get(edge.sourceId)!.add(edge.targetId);
    adjacency.get(edge.targetId)!.add(edge.sourceId);
  }

  const denominator = Math.max(1, graph.nodes.length - 1);
  const noteMetrics = graph.nodes.map((node): GraphNoteMetric => {
    const outgoingCount = outgoing.get(node.id)!.size;
    const incomingCount = incoming.get(node.id)!.size;
    const degree = incomingCount + outgoingCount;
    return {
      id: node.id,
      title: node.title,
      path: node.path,
      incoming: incomingCount,
      outgoing: outgoingCount,
      degree,
      degreeCentrality: graph.nodes.length <= 1 ? 0 : degree / denominator,
    };
  }).sort(compareMetric);
  const metricById = new Map(noteMetrics.map((metric) => [metric.id, metric]));

  const visited = new Set<string>();
  const components: GraphComponentSummary[] = [];
  for (const node of [...graph.nodes].sort(compareNode)) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const memberIds: string[] = [];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      memberIds.push(current);
      for (const neighbour of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
    const members = memberIds.map((id) => metricById.get(id)!).sort(compareMetric);
    const representative = members[0]!;
    components.push({
      id: [...memberIds].sort()[0] ?? representative.id,
      size: members.length,
      totalDegree: members.reduce((sum, member) => sum + member.degree, 0),
      representative,
      members,
    });
  }
  components.sort((left, right) => right.size - left.size
    || right.totalDegree - left.totalDegree
    || left.representative.title.localeCompare(right.representative.title)
    || left.id.localeCompare(right.id));

  const linkedNotes = noteMetrics.filter((metric) => metric.degree > 0).length;
  return {
    totalNotes: noteMetrics.length,
    linkedNotes,
    isolatedNotes: noteMetrics.length - linkedNotes,
    unresolvedLinks: graph.unresolvedCount,
    ambiguousLinks: graph.ambiguousCount,
    selfLinkEdges,
    selfLinkOccurrences,
    componentCount: components.length,
    largestComponentSize: components[0]?.size ?? 0,
    mostConnected: noteMetrics.slice(0, limit),
    noteMetrics,
    components,
  };
}

function compareNode(left: GraphNode, right: GraphNode): number {
  return left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

function compareMetric(left: GraphNoteMetric, right: GraphNoteMetric): number {
  return right.degree - left.degree || right.incoming - left.incoming || right.outgoing - left.outgoing
    || left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}
