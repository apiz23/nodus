import type { GraphEdge, GraphNode, NoteGraph } from '../../src/links/graph.js';

export interface PositionedNode extends GraphNode { x: number; y: number; unresolved?: boolean; distance?: number }

export interface GraphFilterOptions {
  folder?: string | null;
  showIsolated?: boolean;
  showUnresolved?: boolean;
  /** When set, only notes in this cluster are visible. Unresolved sources outside it are hidden. */
  clusterNodeIds?: ReadonlySet<string> | null;
  /** Stable priority order used before alphabetical truncation. */
  priorityIds?: readonly string[] | null;
  /** Keep these notes visible before truncation, even when the normal sort would omit them. */
  ensureIds?: readonly string[] | null;
  /** Minimum distinct degree (incoming + outgoing). */
  minConnections?: number | null;
  /** Keep only notes with no confirmed incoming links. */
  orphanOnly?: boolean;
  /** Neighborhood depth when `focusId` is set. Defaults to one hop. */
  focusDepth?: number;
}

export interface DisplayGraphNode extends GraphNode {
  /** Virtual node representing an unresolved wiki-link target. */
  unresolved?: boolean;
  /** Shortest undirected distance from the focused note when focus mode is active. */
  distance?: number;
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
  /** Notes matching the filters before the render limit. */
  matched: number;
  /** Notes omitted by the render limit. */
  hiddenByLimit: number;
  /** Distance from the focus note for every rendered node. */
  distanceById: ReadonlyMap<string, number>;
}

export interface GraphMetrics {
  incoming: ReadonlyMap<string, number>;
  outgoing: ReadonlyMap<string, number>;
  degree: ReadonlyMap<string, number>;
  /** Notes with no confirmed incoming link. */
  orphanIds: ReadonlySet<string>;
  /** Notes with no confirmed incoming or outgoing link. */
  isolatedIds: ReadonlySet<string>;
  unresolvedBySource: ReadonlyMap<string, { targets: number; occurrences: number }>;
}

export interface GraphNeighborhood {
  distanceById: ReadonlyMap<string, number>;
  parentById: ReadonlyMap<string, string | null>;
  edgeById: ReadonlyMap<string, GraphEdge>;
  boundaryEdges: GraphEdge[];
}

function normalized(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
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

function compareNode(left: GraphNode, right: GraphNode): number {
  return left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

/** Derive degree, orphan and unresolved-link metrics without mutating the graph. */
export function graphMetrics(graph: NoteGraph): GraphMetrics {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const degree = new Map<string, number>();
  const unresolvedBySource = new Map<string, { targets: number; occurrences: number }>();
  for (const node of graph.nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, 0);
    degree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    if (edge.sourceId === edge.targetId) continue;
    outgoing.set(edge.sourceId, (outgoing.get(edge.sourceId) ?? 0) + 1);
    incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1);
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }
  for (const link of graph.unresolvedLinks ?? []) {
    const current = unresolvedBySource.get(link.sourceId) ?? { targets: 0, occurrences: 0 };
    current.targets += 1;
    current.occurrences += link.linkCount;
    unresolvedBySource.set(link.sourceId, current);
  }
  const orphanIds = new Set(graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id));
  const isolatedIds = new Set(graph.isolatedNodeIds ?? graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0 && (outgoing.get(node.id) ?? 0) === 0)
    .map((node) => node.id));
  return { incoming, outgoing, degree, orphanIds, isolatedIds, unresolvedBySource };
}

/** Breadth-first neighborhood over the confirmed edge set. Traversal is deterministic. */
export function graphNeighborhood(
  graph: NoteGraph,
  rootId: string,
  depth = 1,
  direction: 'both' | 'incoming' | 'outgoing' = 'both',
): GraphNeighborhood {
  return neighborhoodFromEdges(graph.nodes, graph.edges, rootId, depth, direction);
}

function neighborhoodFromEdges(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  rootId: string,
  depth: number,
  direction: 'both' | 'incoming' | 'outgoing' = 'both',
): GraphNeighborhood {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(rootId)) {
    return { distanceById: new Map(), parentById: new Map(), edgeById: new Map(), boundaryEdges: [] };
  }
  const adjacency = new Map<string, Array<{ id: string; edge: GraphEdge }>>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (edge.sourceId === edge.targetId) continue;
    if (direction !== 'incoming') adjacency.get(edge.sourceId)?.push({ id: edge.targetId, edge });
    if (direction !== 'outgoing') adjacency.get(edge.targetId)?.push({ id: edge.sourceId, edge });
  }
  for (const list of adjacency.values()) {
    list.sort((left, right) => {
      const leftNode = byId.get(left.id);
      const rightNode = byId.get(right.id);
      return leftNode === undefined ? 1 : rightNode === undefined ? -1 : compareNode(leftNode, rightNode);
    });
  }
  const distanceById = new Map<string, number>([[rootId, 0]]);
  const parentById = new Map<string, string | null>([[rootId, null]]);
  const edgeById = new Map<string, GraphEdge>();
  const queue = [rootId];
  const maxDepth = Math.max(0, Math.floor(depth));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = distanceById.get(current) ?? 0;
    if (currentDistance >= maxDepth) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distanceById.has(neighbor.id)) continue;
      distanceById.set(neighbor.id, currentDistance + 1);
      parentById.set(neighbor.id, current);
      edgeById.set(neighbor.id, neighbor.edge);
      queue.push(neighbor.id);
    }
  }
  const boundaryEdges = edges.filter((edge) => {
    const sourceInside = distanceById.has(edge.sourceId);
    const targetInside = distanceById.has(edge.targetId);
    return sourceInside !== targetInside;
  });
  return { distanceById, parentById, edgeById, boundaryEdges };
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
  const metrics = graphMetrics(graph);
  const clusterNodeIds = options.clusterNodeIds ?? null;
  const priority = new Map((options.priorityIds ?? []).map((id, index) => [id, index]));
  const ensure = new Set(options.ensureIds ?? []);
  const minConnections = options.minConnections ?? null;
  const matchingNotes = graph.nodes.filter((node) => {
    if (clusterNodeIds !== null && !clusterNodeIds.has(node.id)) return false;
    if (!matchesFolder(node.path, folder)) return false;
    if (!showIsolated && metrics.isolatedIds.has(node.id)) return false;
    if (options.orphanOnly === true && !metrics.orphanIds.has(node.id)) return false;
    if (minConnections !== null && (metrics.degree.get(node.id) ?? 0) < minConnections) return false;
    if (!normalizedQuery) return true;
    return normalized(`${node.title}\n${node.path}`).includes(normalizedQuery);
  });
  const nodes: DisplayGraphNode[] = matchingNotes.map((node) => ({ ...node }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: DisplayGraphEdge[] = graph.edges
    .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
    .map((edge) => ({ ...edge }));

  if (showUnresolved) {
    const sourceById = new Map(nodes.map((node) => [node.id, node]));
    for (const link of graph.unresolvedLinks ?? []) {
      const source = sourceById.get(link.sourceId);
      if (source === undefined) continue;
      if (normalizedQuery
        && !normalized(link.target).includes(normalizedQuery)
        && !normalized(`${source.title}\n${source.path}`).includes(normalizedQuery)) continue;
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
  let distanceById = new Map<string, number>();
  const focusExists = focusId !== null && (byId.has(focusId) || graph.nodes.some((node) => node.id === focusId));
  if (focusId !== null && focusExists) {
    const neighborhood = neighborhoodFromEdges(nodes, edges, focusId, options.focusDepth ?? 1);
    distanceById = new Map(neighborhood.distanceById);
    candidates = nodes.filter((node) => neighborhood.distanceById.has(node.id));
    if (!candidates.some((node) => node.id === focusId)) {
      const focused = graph.nodes.find((node) => node.id === focusId);
      if (focused) {
        candidates = [{ ...focused, distance: 0 }, ...candidates];
        distanceById.set(focusId, 0);
      }
    }
  }

  const unique = [...new Map(candidates.map((node) => [node.id, node])).values()];
  // Pinning is for the render limit only. A note excluded by an explicit
  // query/folder/cluster/connection filter must stay excluded so the
  // no-match state remains truthful.
  const filteredIds = new Set(unique.map((node) => node.id));
  for (const id of ensure) {
    if (!filteredIds.has(id) || unique.some((node) => node.id === id)) continue;
    const ensured = graph.nodes.find((node) => node.id === id);
    if (ensured !== undefined) unique.push({ ...ensured, distance: distanceById.get(id) });
  }
  unique.sort((left, right) => {
    if (left.id === focusId) return -1;
    if (right.id === focusId) return 1;
    const leftDistance = distanceById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightDistance = distanceById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const priorityDelta = (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    if (priorityDelta !== 0) return priorityDelta;
    const unresolvedDelta = Number(left.unresolved === true) - Number(right.unresolved === true);
    if (unresolvedDelta !== 0) return unresolvedDelta;
    const degreeDelta = (metrics.degree.get(right.id) ?? 0) - (metrics.degree.get(left.id) ?? 0);
    return degreeDelta || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
  const pinned = unique.filter((node) => ensure.has(node.id));
  const pinnedIds = new Set(pinned.map((node) => node.id));
  const remainder = unique.filter((node) => !pinnedIds.has(node.id));
  const limited = [...pinned, ...remainder.slice(0, Math.max(0, limit - pinned.length))].slice(0, limit);
  const ids = new Set(limited.map((node) => node.id));
  const renderedDistance = new Map<string, number>();
  for (const node of limited) {
    const distance = distanceById.get(node.id);
    if (distance !== undefined) {
      node.distance = distance;
      renderedDistance.set(node.id, distance);
    }
  }
  return {
    nodes: limited,
    edges: edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)),
    total: unique.length,
    truncated: unique.length > limited.length,
    noteCount: limited.filter((node) => node.unresolved !== true).length,
    unresolvedCount: limited.filter((node) => node.unresolved === true).length,
    matched: unique.length,
    hiddenByLimit: Math.max(0, unique.length - limited.length),
    distanceById: renderedDistance,
  };
}

export function graphConnections(edges: readonly GraphEdge[], noteId: string) {
  const incoming = edges.filter((edge) => edge.targetId === noteId).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const outgoing = edges.filter((edge) => edge.sourceId === noteId).sort((a, b) => a.targetId.localeCompare(b.targetId));
  return { incoming, outgoing };
}

export interface GraphLayoutOptions {
  clusterByNode?: ReadonlyMap<string, string> | null;
  isolatedNodeIds?: ReadonlySet<string> | null;
  /** Horizontal/vertical cell spacing before fit-to-view. */
  spacingX?: number;
  spacingY?: number;
  /** Confirmed and unresolved edges used by the one-shot topology layout. */
  edges?: readonly GraphEdge[];
  /** BFS distance from the focused note, used to keep local depth rings readable. */
  depthByNode?: ReadonlyMap<string, number> | null;
}

export function positionGraph(
  nodes: readonly GraphNode[],
  focusId: string | null,
  width = 1000,
  height = 640,
  options?: GraphLayoutOptions,
): PositionedNode[] {
  if (options === undefined) {
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
  const sorted = [...nodes].sort((left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  const focused = focusId === null ? undefined : sorted.find((node) => node.id === focusId);
  if (focused !== undefined) return focusLayout(sorted, focused, options);
  if ((options.edges?.length ?? 0) > 0) return forceLayout(sorted, width, height, options);
  return clusterLayout(sorted, width, height, options);
}

function focusLayout(nodes: readonly GraphNode[], focus: GraphNode, options: GraphLayoutOptions): PositionedNode[] {
  const spacing = Math.max(150, options.spacingX ?? 150);
  const groups = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    if (node.id === focus.id) continue;
    const depth = Math.max(1, Math.floor(options.depthByNode?.get(node.id) ?? 1));
    const group = groups.get(depth) ?? [];
    group.push(node);
    groups.set(depth, group);
  }
  const positioned: PositionedNode[] = [{ ...focus, x: 0, y: 0 }];
  for (const [depth, members] of [...groups.entries()].sort((left, right) => left[0] - right[0])) {
    members.sort(compareNode);
    let remaining = members;
    let overflow = 0;
    while (remaining.length > 0) {
      const radius = depth * spacing + overflow * spacing * 0.62;
      const capacity = Math.max(6, Math.floor((2 * Math.PI * radius) / spacing));
      const count = Math.min(capacity, remaining.length);
      const start = -Math.PI / 2 + (overflow % 2 === 0 ? 0 : Math.PI / count);
      for (let index = 0; index < count; index += 1) {
        const node = remaining[index]!;
        const angle = start + (2 * Math.PI * index) / count;
        positioned.push({ ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      remaining = remaining.slice(count);
      overflow += 1;
    }
  }
  return positioned;
}

/**
 * One-shot deterministic topology layout. It runs a bounded number of
 * attraction/repulsion passes once per visible graph; it never animates or
 * schedules a frame. Grid layout remains the fallback for graphs without edges.
 */
function forceLayout(nodes: readonly GraphNode[], width: number, height: number, options: GraphLayoutOptions): PositionedNode[] {
  const count = nodes.length;
  if (count === 0) return [];
  const degreeById = new Map<string, number>();
  for (const edge of options.edges ?? []) {
    if (edge.sourceId === edge.targetId) continue;
    degreeById.set(edge.sourceId, (degreeById.get(edge.sourceId) ?? 0) + 1);
    degreeById.set(edge.targetId, (degreeById.get(edge.targetId) ?? 0) + 1);
  }
  // Seed the most connected note at the centre so the layout reads like a hub,
  // not a shelf of blocks. Remaining nodes spiral outward in title/id order.
  const ranked = [...nodes].sort((left, right) => {
    const degreeDelta = (degreeById.get(right.id) ?? 0) - (degreeById.get(left.id) ?? 0);
    return degreeDelta || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
  const positions = ranked.map((node, index) => {
    if (index === 0) return { id: node.id, x: 0, y: 0 };
    const angle = (index - 1) * Math.PI * (3 - Math.sqrt(5));
    const radius = 34 * Math.sqrt(index);
    return { id: node.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indexById = new Map(positions.map((position, index) => [position.id, index]));
  const edges = (options.edges ?? []).flatMap((edge) => {
    const source = indexById.get(edge.sourceId);
    const target = indexById.get(edge.targetId);
    if (source === undefined || target === undefined || source === target) return [];
    return [{ source, target, weight: Math.min(4, edge.linkCount) }];
  });
  const area = width * height;
  const ideal = Math.max(54, Math.sqrt(area / Math.max(1, count)));
  const iterations = count <= 80 ? 110 : count <= 180 ? 64 : 34;
  let temperature = ideal * 1.35;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        let dx = positions[left]!.x - positions[right]!.x;
        let dy = positions[left]!.y - positions[right]!.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          const seed = (left * 37 + right * 17) % 360;
          dx = Math.cos(seed) * 0.1;
          dy = Math.sin(seed) * 0.1;
          distance = 0.1;
        }
        const force = ((ideal * ideal) * 0.36) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces[left]!.x += fx;
        forces[left]!.y += fy;
        forces[right]!.x -= fx;
        forces[right]!.y -= fy;
      }
    }
    for (const edge of edges) {
      const source = positions[edge.source]!;
      const target = positions[edge.target]!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = ((distance * distance) / ideal) * 0.62 * Math.min(1.6, 0.7 + edge.weight * 0.18);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      forces[edge.source]!.x += fx;
      forces[edge.source]!.y += fy;
      forces[edge.target]!.x -= fx;
      forces[edge.target]!.y -= fy;
    }
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index]!;
      const force = forces[index]!;
      force.x -= position.x * 0.02;
      force.y -= position.y * 0.02;
      const magnitude = Math.hypot(force.x, force.y);
      if (magnitude < 0.001) continue;
      const step = Math.min(magnitude, temperature);
      position.x += (force.x / magnitude) * step;
      position.y += (force.y / magnitude) * step;
    }
    temperature *= 0.945;
  }
  // Final collision pass keeps labels and hit targets from piling up.
  const minimum = Math.max(46, ideal * 0.55);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left]!;
        const b = positions[right]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        if (distance >= minimum) continue;
        const push = (minimum - distance) / 2;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const position of positions) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }
  const extentX = Math.max(1, maxX - minX);
  const extentY = Math.max(1, maxY - minY);
  const scale = Math.min((width * 0.92) / extentX, (height * 0.82) / extentY, 1.9);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return nodes.map((node, index) => ({
    ...node,
    x: (positions[index]!.x - centerX) * scale,
    y: (positions[index]!.y - centerY) * scale,
  }));
}

function clusterLayout(nodes: readonly GraphNode[], width: number, height: number, options: GraphLayoutOptions): PositionedNode[] {
  const spacingX = Math.max(110, options.spacingX ?? 138);
  const spacingY = Math.max(80, options.spacingY ?? 94);
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = options.isolatedNodeIds?.has(node.id) ? '__isolated__' : options.clusterByNode?.get(node.id) ?? '__unclustered__';
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  // Very small components become noise in a shelf layout. Merge them into one
  // block so a fragmented vault does not explode into hundreds of tiny islands.
  const merged = new Map<string, GraphNode[]>();
  for (const [key, members] of groups) {
    const target = key !== '__isolated__' && members.length <= 2 ? '__small__' : key;
    const group = merged.get(target) ?? [];
    group.push(...members);
    merged.set(target, group);
  }
  const blocks = [...merged.entries()].map(([id, members]) => {
    members.sort((left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
    const columns = Math.max(1, Math.ceil(Math.sqrt(members.length * 1.45)));
    const rows = Math.ceil(members.length / columns);
    return { id, members, columns, rows, width: Math.max(spacingX, columns * spacingX), height: Math.max(spacingY, rows * spacingY) };
  }).sort((left, right) => right.members.length - left.members.length || left.id.localeCompare(right.id));
  const gap = 170;
  const totalArea = blocks.reduce((sum, block) => sum + (block.width + gap) * (block.height + gap), 0);
  const maxRowWidth = Math.max(width * 0.9, Math.sqrt(totalArea * 1.5));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const positioned: PositionedNode[] = [];
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.width > maxRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    const startX = cursorX + (block.columns - 1) * spacingX / 2;
    const startY = cursorY + (block.rows - 1) * spacingY / 2;
    block.members.forEach((node, index) => {
      const column = index % block.columns;
      const row = Math.floor(index / block.columns);
      positioned.push({ ...node, x: column * spacingX - startX + block.width / 2 - spacingX / 2, y: row * spacingY - startY + block.height / 2 - spacingY / 2 });
    });
    cursorX += block.width + gap;
    rowHeight = Math.max(rowHeight, block.height);
  }
  if (positioned.length === 0) return [];
  const minX = Math.min(...positioned.map((node) => node.x));
  const maxX = Math.max(...positioned.map((node) => node.x));
  const minY = Math.min(...positioned.map((node) => node.y));
  const maxY = Math.max(...positioned.map((node) => node.y));
  const offsetX = (minX + maxX) / 2;
  const offsetY = (minY + maxY) / 2;
  return positioned.map((node) => ({ ...node, x: node.x - offsetX, y: node.y - offsetY }));
}
