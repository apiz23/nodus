import { describe, expect, it } from 'vitest';
import { positionGraph } from '../ui/src/graph-model.js';

const nodes = Array.from({ length: 400 }, (_, index) => ({ id: `n${index}`, title: `Note ${String(index).padStart(3, '0')}`, path: `folder-${Math.floor(index / 100)}/note-${index}.md` }));
const clusterByNode = new Map(nodes.map((node, index) => [node.id, `cluster-${Math.floor(index / 80)}`]));

function minimumDistance(positions: ReturnType<typeof positionGraph>): number {
  let min = Infinity;
  for (let i = 0; i < positions.length; i += 1) for (let j = i + 1; j < positions.length; j += 1) {
    min = Math.min(min, Math.hypot(positions[i]!.x - positions[j]!.x, positions[i]!.y - positions[j]!.y));
  }
  return min;
}

describe('deterministic graph layout', () => {
  it('is deterministic and keeps cluster-aware nodes separated', () => {
    for (const size of [100, 200, 400]) {
      const subset = nodes.slice(0, size);
      const options = { clusterByNode, isolatedNodeIds: new Set<string>() };
      const first = positionGraph(subset, null, 1000, 640, options);
      const second = positionGraph(subset, null, 1000, 640, options);
      expect(first).toEqual(second);
      expect(new Set(first.map((node) => `${node.x}:${node.y}`)).size).toBe(size);
      expect(minimumDistance(first)).toBeGreaterThan(80);
    }
  });

  it('places focused notes at the centre and neighbours in rings', () => {
    const positions = positionGraph(nodes.slice(0, 40), 'n0', 1000, 640, { clusterByNode, isolatedNodeIds: new Set<string>() });
    expect(positions.find((node) => node.id === 'n0')).toMatchObject({ x: 0, y: 0 });
    expect(positions.filter((node) => node.id !== 'n0').every((node) => Math.hypot(node.x, node.y) >= 100)).toBe(true);
  });

  it('positions isolated notes in a separate bounded group', () => {
    const subset = nodes.slice(0, 20);
    const isolated = new Set(subset.slice(0, 10).map((node) => node.id));
    const positions = positionGraph(subset, null, 1000, 640, { clusterByNode, isolatedNodeIds: isolated });
    expect(new Set(positions.map((node) => `${node.x}:${node.y}`)).size).toBe(20);
  });
});
