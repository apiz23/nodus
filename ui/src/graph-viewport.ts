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
  return {
    x: viewport.x + dxScreen / safeScale / viewport.scale,
    y: viewport.y + dyScreen / safeScale / viewport.scale,
    scale: viewport.scale,
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

export function graphViewportTransform(viewport: GraphViewport): string {
  return `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
}
