export const AUTOSAVE_DELAY_MS = 700;

export function scheduleAutosave(callback: () => void): () => void {
  const timer = setTimeout(callback, AUTOSAVE_DELAY_MS);
  return () => clearTimeout(timer);
}
