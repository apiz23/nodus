export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}

export const GRAPH_VIEW_WIDTH = 1000;
export const GRAPH_VIEW_HEIGHT = 640;
export const GRAPH_MIN_SCALE = 0.12;
export const GRAPH_MAX_SCALE = 3;

export function clampGraphScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(GRAPH_MIN_SCALE, Math.min(GRAPH_MAX_SCALE, scale));
}

export function centeredGraphViewport(scale = 1): GraphViewport {
  return { x: GRAPH_VIEW_WIDTH / 2, y: GRAPH_VIEW_HEIGHT / 2, scale: clampGraphScale(scale) };
}

/** Convert a client pointer to SVG viewBox coordinates with preserveAspectRatio meet letterboxing. */
export function clientToGraphViewBox(
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const displayScale = Math.min(bounds.width / GRAPH_VIEW_WIDTH, bounds.height / GRAPH_VIEW_HEIGHT);
  const safeScale = displayScale > 0 ? displayScale : 1;
  const offsetX = (bounds.width - GRAPH_VIEW_WIDTH * safeScale) / 2;
  const offsetY = (bounds.height - GRAPH_VIEW_HEIGHT * safeScale) / 2;
  return { x: (clientX - bounds.left - offsetX) / safeScale, y: (clientY - bounds.top - offsetY) / safeScale };
}

/** Zoom around a viewBox-space point, keeping that point visually fixed. */
export function zoomGraphViewportAt(viewport: GraphViewport, point: { x: number; y: number }, factor: number): GraphViewport {
  const scale = clampGraphScale(viewport.scale * factor);
  const worldX = (point.x - viewport.x) / viewport.scale;
  const worldY = (point.y - viewport.y) / viewport.scale;
  return { x: point.x - worldX * scale, y: point.y - worldY * scale, scale };
}

export function panGraphViewport(viewport: GraphViewport, dxScreen: number, dyScreen: number, bounds: { width: number; height: number }): GraphViewport {
  const displayScale = Math.min(bounds.width / GRAPH_VIEW_WIDTH, bounds.height / GRAPH_VIEW_HEIGHT);
  const safeScale = displayScale > 0 ? displayScale : 1;
  // The viewport group applies translate() before scale(), so screen movement
  // is displayScale * Δtranslate. Dividing by scale as well made panning lag at
  // high zoom and overshoot at low zoom.
  return {
    x: viewport.x + dxScreen / safeScale,
    y: viewport.y + dyScreen / safeScale,
    scale: viewport.scale,
  };
}

/** Center a world-space point in the viewBox without changing zoom. */
export function centerGraphViewportOn(point: { x: number; y: number }, scale = 1): GraphViewport {
  const safeScale = clampGraphScale(scale);
  return {
    x: GRAPH_VIEW_WIDTH / 2 - point.x * safeScale,
    y: GRAPH_VIEW_HEIGHT / 2 - point.y * safeScale,
    scale: safeScale,
  };
}

export function fitGraphViewport(
  positions: ReadonlyArray<{ x: number; y: number }>,
  padding = 90,
  minScale = GRAPH_MIN_SCALE,
  maxScale = 1.65,
): GraphViewport {
  if (positions.length === 0) return centeredGraphViewport();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const position of positions) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }
  const width = Math.max(1, maxX - minX + padding * 2);
  const height = Math.max(1, maxY - minY + padding * 2);
  const scale = Math.max(minScale, Math.min(maxScale, GRAPH_VIEW_WIDTH / width, GRAPH_VIEW_HEIGHT / height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { x: GRAPH_VIEW_WIDTH / 2 - centerX * scale, y: GRAPH_VIEW_HEIGHT / 2 - centerY * scale, scale };
}

/**
 * Fit content while keeping a preferred point at the viewBox centre. Useful for
 * hub-style graphs where the central note should stay visually centred.
 */
export function fitGraphViewportAroundPoint(
  positions: ReadonlyArray<{ x: number; y: number }>,
  centerPoint: { x: number; y: number } | null,
  padding = 90,
  minScale = GRAPH_MIN_SCALE,
  maxScale = 1.65,
): GraphViewport {
  if (centerPoint === null) return fitGraphViewport(positions, padding, minScale, maxScale);
  const distances = positions.map((position) => Math.hypot(position.x - centerPoint.x, position.y - centerPoint.y));
  const maxDistance = distances.length === 0 ? 0 : Math.max(...distances);
  if (!Number.isFinite(maxDistance) || maxDistance <= 0.001) {
    const viewport = centeredGraphViewport(maxScale);
    return { ...viewport, scale: clampGraphScale(maxScale) };
  }
  const availableX = (GRAPH_VIEW_WIDTH / 2) - padding;
  const availableY = (GRAPH_VIEW_HEIGHT / 2) - padding;
  const scale = clampScale(
    Math.min(maxScale, Math.max(minScale, Math.min(availableX / maxDistance, availableY / maxDistance))),
  );
  return {
    x: GRAPH_VIEW_WIDTH / 2 - centerPoint.x * scale,
    y: GRAPH_VIEW_HEIGHT / 2 - centerPoint.y * scale,
    scale,
  };
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(GRAPH_MIN_SCALE, Math.min(GRAPH_MAX_SCALE, scale));
}

export function graphViewportTransform(viewport: GraphViewport): string {
  return `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
}
