import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addTag, tagIdentity, TagValidationError } from '../../../src/domain/tags.js';

export function TagEditor({
  noteId,
  tags,
  disabled = false,
  disabledReason,
  busy = false,
  onAdd,
  onRemove,
}: {
  noteId: string;
  tags: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  onAdd: (tag: string) => Promise<void>;
  onRemove: (tag: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  useEffect(() => {
    generationRef.current += 1;
    setValue('');
    setError(null);
    setPending(false);
  }, [noteId]);

  const isBusy = busy || pending;
  const isDisabled = disabled || isBusy;
  const hintId = `tag-editor-hint-${noteId}`;
  const errorId = `tag-editor-error-${noteId}`;

  async function addCurrentTag(): Promise<void> {
    let next: string;
    try {
      next = addTag(tags, value).at(-1)!;
    } catch (cause) {
      setError(cause instanceof TagValidationError ? cause.message : 'Enter a valid tag.');
      return;
    }
    const requestNoteId = noteId;
    const generation = generationRef.current;
    setError(null);
    setPending(true);
    try {
      await onAdd(next);
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) setValue('');
    } catch (cause) {
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) {
        setError(cause instanceof Error ? cause.message : 'Could not add this tag. Try again.');
      }
    } finally {
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) setPending(false);
    }
  }

  async function removeExistingTag(tag: string): Promise<void> {
    const requestNoteId = noteId;
    const generation = generationRef.current;
    setError(null);
    setPending(true);
    try {
      await onRemove(tag);
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) inputRef.current?.focus();
    } catch (cause) {
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) {
        setError(cause instanceof Error ? cause.message : 'Could not remove this tag. Try again.');
      }
    } finally {
      if (generationRef.current === generation && noteIdRef.current === requestNoteId) setPending(false);
    }
  }

  return (
    <section className="mt-3 flex flex-col gap-2" aria-label="Tags">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Note tags">
        {tags.map((tag, index) => (
          <span className="inline-flex items-center gap-0.5" key={`${tagIdentity(tag)}-${index}`}>
            <Badge variant="secondary" className="font-normal">#{tag}</Badge>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-5 rounded-full text-muted-foreground"
              aria-label={`Remove tag ${tag}`}
              disabled={isDisabled}
              onClick={() => void removeExistingTag(tag)}
            >
              <X />
            </Button>
          </span>
        ))}
      </div>
      <div className="flex min-w-0 max-w-sm items-center gap-1.5">
        <label className="sr-only" htmlFor={`tag-input-${noteId}`}>Add tag</label>
        <Input
          ref={inputRef}
          id={`tag-input-${noteId}`}
          value={value}
          onChange={(event) => { setValue(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              if (!isDisabled) void addCurrentTag();
            } else if (event.key === 'Backspace' && value === '' && tags.length > 0 && !isDisabled) {
              event.preventDefault();
              void removeExistingTag(tags[tags.length - 1]!);
            }
          }}
          placeholder="Add a tag"
          aria-label="Add tag"
          aria-invalid={error !== null}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          disabled={isDisabled}
          className="h-7 text-xs"
        />
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isDisabled || value.trim() === ''} onClick={() => void addCurrentTag()}>
          {isBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          Add
        </Button>
      </div>
      <p id={hintId} className="text-[11px] text-muted-foreground">
        {disabled ? disabledReason : 'Press Enter or comma to add. Backspace on an empty field removes the last tag.'}
      </p>
      {isBusy && <p className="text-xs text-muted-foreground" role="status" aria-live="polite">Saving tag changes…</p>}
      {error && <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
