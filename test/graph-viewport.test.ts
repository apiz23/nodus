import { describe, expect, it } from 'vitest';
import {
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  centeredGraphViewport,
  clientToGraphViewBox,
  fitGraphViewport,
  panGraphViewport,
  zoomGraphViewportAt,
} from '../ui/src/graph-viewport.js';

describe('graph viewport math', () => {
  it('zooms around a fixed viewBox point and clamps scale', () => {
    const viewport = { x: 500, y: 320, scale: 1 };
    const point = { x: 250, y: 180 };
    const zoomed = zoomGraphViewportAt(viewport, point, 2);
    expect(zoomed.scale).toBe(2);
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo((point.x - viewport.x) / viewport.scale);
    expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo((point.y - viewport.y) / viewport.scale);
    expect(zoomGraphViewportAt(viewport, point, 100).scale).toBe(GRAPH_MAX_SCALE);
    expect(zoomGraphViewportAt(viewport, point, 0.001).scale).toBe(GRAPH_MIN_SCALE);
  });

  it('converts client coordinates through preserveAspectRatio letterboxing', () => {
    const point = clientToGraphViewBox(500, 300, { left: 0, top: 0, width: 1000, height: 640 });
    expect(point).toEqual({ x: 500, y: 300 });
    const letterboxed = clientToGraphViewBox(640, 300, { left: 0, top: 0, width: 1280, height: 640 });
    expect(letterboxed.x).toBeCloseTo(500);
    expect(letterboxed.y).toBeCloseTo(300);
  });

  it('pans in viewBox units and fits all positions', () => {
    const panned = panGraphViewport({ x: 500, y: 320, scale: 2 }, 100, 50, { width: 1000, height: 640 });
    expect(panned.x).toBeCloseTo(550);
    expect(panned.y).toBeCloseTo(345);
    const fit = fitGraphViewport([{ x: -1000, y: -600 }, { x: 1000, y: 600 }]);
    expect(fit.scale).toBeLessThanOrEqual(1.65);
    expect(fit.scale).toBeGreaterThanOrEqual(0.25);
    expect(centeredGraphViewport().x).toBe(500);
  });
});
