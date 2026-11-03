import type { GraphEdge, GraphNode, NoteGraph } from './graph.js';
import type { GraphAnalytics, GraphNoteMetric } from './graph-analytics.js';

export interface ClusterRelationNote {
  note: GraphNode;
  linkCount: number;
}

export interface GraphClusterInsights {
  id: string;
  memberCount: number;
  internalEdges: number;
  internalLinkOccurrences: number;
  density: number;
  externalIncomingEdges: number;
  externalOutgoingEdges: number;
  mostConnected: GraphNoteMetric[];
  entryNotes: ClusterRelationNote[];
  exitNotes: ClusterRelationNote[];
}

/** Measured cluster connectivity. Cluster membership comes from Phase 20 components. */
export function graphClusterInsights(graph: NoteGraph, analytics: GraphAnalytics, clusterId: string): GraphClusterInsights | undefined {
  const component = analytics.components.find((candidate) => candidate.id === clusterId);
  if (component === undefined) return undefined;
  const memberIds = new Set(component.members.map((member) => member.id));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  let internalEdges = 0;
  let internalLinkOccurrences = 0;
  let externalIncomingEdges = 0;
  let externalOutgoingEdges = 0;
  const internalIncoming = new Map<string, Set<string>>();
  const internalOutgoing = new Map<string, Set<string>>();
  for (const member of component.members) {
    internalIncoming.set(member.id, new Set());
    internalOutgoing.set(member.id, new Set());
  }
  for (const edge of graph.edges) {
    if (edge.sourceId === edge.targetId) continue;
    const sourceInside = memberIds.has(edge.sourceId);
    const targetInside = memberIds.has(edge.targetId);
    if (sourceInside && targetInside) {
      internalEdges += 1;
      internalLinkOccurrences += edge.linkCount;
      internalIncoming.get(edge.targetId)?.add(edge.sourceId);
      internalOutgoing.get(edge.sourceId)?.add(edge.targetId);
    } else if (!sourceInside && targetInside) {
      externalIncomingEdges += 1;
    } else if (sourceInside && !targetInside) {
      externalOutgoingEdges += 1;
    }
  }
  const possibleDirectedPairs = component.size * Math.max(0, component.size - 1);
  const membersWith = (degrees: Map<string, Set<string>>, oppositeDegrees: Map<string, Set<string>>, empty: boolean) => component.members
    .filter((member) => (degrees.get(member.id)?.size ?? 0) === (empty ? 0 : -1))
    .flatMap((member) => {
      const note = byId.get(member.id);
      return note === undefined ? [] : [{ note, linkCount: oppositeDegrees.get(member.id)?.size ?? 0 }];
    })
    .sort((left, right) => right.linkCount - left.linkCount
      || left.note.title.localeCompare(right.note.title)
      || left.note.path.localeCompare(right.note.path)
      || left.note.id.localeCompare(right.note.id))
    .slice(0, 10);
  return {
    id: component.id,
    memberCount: component.size,
    internalEdges,
    internalLinkOccurrences,
    density: possibleDirectedPairs === 0 ? 0 : Number((internalEdges / possibleDirectedPairs).toFixed(4)),
    externalIncomingEdges,
    externalOutgoingEdges,
    mostConnected: component.members.slice(0, 8),
    entryNotes: membersWith(internalIncoming, internalOutgoing, true),
    exitNotes: membersWith(internalOutgoing, internalIncoming, true),
  };
}
