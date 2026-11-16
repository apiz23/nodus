export type GraphDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export interface GraphKeyboardNode {
  id: string;
  x: number;
  y: number;
}

/**
 * Pick the closest visible node in a direction with a comfortable 70° cone.
 * Deterministic ties use title/id order supplied by the caller's candidate list.
 */
export function nearestGraphNode(
  current: GraphKeyboardNode,
  candidates: readonly GraphKeyboardNode[],
  direction: GraphDirection,
): string | null {
  const vector = direction === 'ArrowUp' ? { x: 0, y: -1 }
    : direction === 'ArrowDown' ? { x: 0, y: 1 }
      : direction === 'ArrowLeft' ? { x: -1, y: 0 }
        : { x: 1, y: 0 };
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.id === current.id) continue;
    const dx = candidate.x - current.x;
    const dy = candidate.y - current.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) continue;
    const forward = (dx * vector.x + dy * vector.y) / distance;
    if (forward < 0.342) continue; // roughly a 70° cone
    const lateral = Math.abs(dx * vector.y - dy * vector.x) / distance;
    const score = distance + lateral * distance * 1.8 + (1 - forward) * 120;
    if (best === null || score < best.score) best = { id: candidate.id, score };
  }
  return best?.id ?? null;
}
