import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { analyzeOrganization } from '../src/organization/analysis.js';
import { buildRetrievalIndex } from '../src/search/retrieval.js';

function fixture(size: number) {
  const themes = ['forest ecology canopy rainfall soil roots biodiversity', 'river watershed erosion sediment wetlands habitat',
    'astronomy telescope orbit spectrum stellar observation', 'architecture timber daylight structure acoustics'];
  const topics = Array.from({ length: 20 }, (_, index) => `${themes[index % themes.length]} topic marker${index}`);
  return Array.from({ length: size }, (_, i) => {
    const topic = i % topics.length;
    const folder = i % 100 === 0 ? '' : `notes/topic-${topic}`;
    return createNote({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      title: `Notebook ${i}`, path: `${folder ? `${folder}/` : ''}note-${i}.md`,
      body: `${topics[topic]} field observation record durable practice shared methodology detail record${i}.`,
      now: '2026-11-03T00:00:00Z', tags: i % 3 === 0 ? [`topic-${topic}`] : [] });
  });
}
function measure<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now(); const value = run(); return { value, ms: performance.now() - start };
}

it('measures organization indexing, analysis stages, one-edit rebuild and memory at 1k/5k/10k notes', () => {
  const results = [];
  for (const size of [1_000, 5_000, 10_000]) {
    const notes = fixture(size);
    const heapBefore = process.memoryUsage().heapUsed;
    const initialIndex = measure(() => buildRetrievalIndex(notes.map((note) => ({ id: note.id, title: note.title, body: note.body,
      aliases: note.aliases, tags: note.tags, propertyText: '' }))));
    const links = buildLinkIndex(notes);
    const stages: Record<string, number> = {};
    const initialAnalysis = measure(() => analyzeOrganization(notes, links, initialIndex.value, undefined, {
      onStageTiming: (stage, milliseconds) => { stages[stage] = milliseconds; },
    }));
    const changed = [...notes];
    const index = Math.floor(size / 2);
    changed[index] = { ...changed[index]!, body: `${changed[index]!.body} revised field observation.` };
    const editIndex = measure(() => buildRetrievalIndex(changed.map((note) => ({ id: note.id, title: note.title, body: note.body,
      aliases: note.aliases, tags: note.tags, propertyText: '' })), initialIndex.value));
    const editAnalysis = measure(() => analyzeOrganization(changed, buildLinkIndex(changed), editIndex.value));
    results.push({ notes: size, initialIndexMs: Number(initialIndex.ms.toFixed(2)), initialAnalysisMs: Number(initialAnalysis.ms.toFixed(2)),
      stagesMs: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Number(value.toFixed(2))])),
      oneEditIndexRebuildMs: Number(editIndex.ms.toFixed(2)), reusedDocuments: editIndex.value.reusedDocuments,
      fullAnalysisAfterOneEditMs: Number(editAnalysis.ms.toFixed(2)),
      suggestionCount: initialAnalysis.value.suggestions.length, truncated: initialAnalysis.value.truncated,
      heapDeltaMiB: Number(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2)),
      rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)) });
  }
  process.stdout.write(`${JSON.stringify({ node: process.version, method: 'one in-process run per size; synthetic four-topic corpus; timings are observational; heap includes fixtures and indexes', results })}\n`);
});
