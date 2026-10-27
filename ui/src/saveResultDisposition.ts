export type SaveResultDisposition = 'ignore' | 'keep-draft' | 'replace-draft';

/** Decide whether an async save response still belongs to the visible draft. */
export function saveResultDisposition(
  savedNoteId: string,
  activeNoteId: string | null,
  savedRevision: number,
  currentRevision: number,
): SaveResultDisposition {
  if (activeNoteId !== savedNoteId) return 'ignore';
  return savedRevision === currentRevision ? 'replace-draft' : 'keep-draft';
}
