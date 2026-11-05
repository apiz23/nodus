import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { buildTaskProjection, extractTasksFromBody, setTaskChecked } from '../src/tasks/extract.js';
import { filterTasks, groupTasks, sortTasks } from '../ui/src/task-view.js';

function fixture(size: number) {
  return Array.from({ length: size }, (_, index) => createNote({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: `Notebook ${index}`,
    path: `${index % 100 === 0 ? '' : `notes/topic-${index % 20}/`}note-${index}.md`,
    body: [
      `# Notebook ${index}`,
      '',
      `- [ ] Review field observation ${index}`,
      `- [x] File durable practice ${index}`,
      `- [ ] Follow up with collaborator ${index} [due:2026-11-${String((index % 28) + 1).padStart(2, '0')}] [priority:${index % 2 === 0 ? 'high' : 'low'}]`,
    ].join('\n'),
    now: '2026-11-03T00:00:00Z',
  }));
}

function measure<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

it('measures task extraction, projection, warm filtering, incremental rebuild, and task toggling at 1k/5k/10k notes', () => {
  const results = [];
  for (const size of [1_000, 5_000, 10_000]) {
    const notes = fixture(size);
    const hashes = new Map(notes.map((note) => [note.id, `${note.id}:hash`] as const));
    const heapBefore = process.memoryUsage().heapUsed;
    const extraction = measure(() => notes.flatMap((note) => extractTasksFromBody(note.body, note, hashes.get(note.id) ?? '')));
    const initial = measure(() => buildTaskProjection(notes, hashes));
    const warmFilter = measure(() => filterTasks(initial.value.tasks, { status: 'open', query: 'collaborator', folder: '' }));
    const warmSort = measure(() => sortTasks(warmFilter.value, 'due'));
    const warmGroup = measure(() => groupTasks(warmSort.value, 'note', '2026-11-03'));
    const changed = [...notes];
    const changedIndex = Math.floor(size / 2);
    changed[changedIndex] = { ...changed[changedIndex]!, body: `${changed[changedIndex]!.body}\n- [ ] New task after edit` };
    const incremental = measure(() => buildTaskProjection(changed, new Map(changed.map((note) => [note.id, note.id === changed[changedIndex]!.id ? `${note.id}:changed` : `${note.id}:hash`] as const)), {}, initial.value));
    const toggleBase = initial.value.tasks[0]!;
    const toggle = measure(() => {
      const note = notes.find((candidate) => candidate.id === toggleBase.noteId)!;
      const nextBody = setTaskChecked(note.body, toggleBase, true);
      return extractTasksFromBody(nextBody, note, `${note.id}:toggled`);
    });
    results.push({
      notes: size,
      tasks: initial.value.tasks.length,
      extractionMs: Number(extraction.ms.toFixed(2)),
      projectionMs: Number(initial.ms.toFixed(2)),
      warmFilterMs: Number(warmFilter.ms.toFixed(2)),
      warmSortMs: Number(warmSort.ms.toFixed(2)),
      warmGroupMs: Number(warmGroup.ms.toFixed(2)),
      filteredTasks: warmFilter.value.length,
      groups: warmGroup.value.length,
      oneEditProjectionMs: Number(incremental.ms.toFixed(2)),
      oneEditTaskCount: incremental.value.tasks.length,
      toggleAndReextractMs: Number(toggle.ms.toFixed(2)),
      truncated: initial.value.truncated,
      heapDeltaMiB: Number(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2)),
      rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    });
  }
  process.stdout.write(`${JSON.stringify({
    node: process.version,
    method: 'one in-process run per size; synthetic three-task notes; timings are observational; update measurement excludes filesystem write and React rendering',
    results,
  })}\n`);
});
