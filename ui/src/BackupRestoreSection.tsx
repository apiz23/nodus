import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Archive, CheckCircle2, Loader2 } from 'lucide-react';
import type {
  BackupReport,
  RestorePreview,
  UiBackupValidationResult,
} from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { isBackupRequestCurrent } from './backupRequest';
import {
  errorMessage,
  formatCounts,
  initialRestoreFlow,
  issuesOf,
  previewHasConflicts,
  restoreFailureTitle,
  restoreFlowReducer,
} from './backupRestore';

interface BackupRestoreSectionProps {
  onRestored: () => void;
  onActivityChange?: (active: boolean) => void;
}

function AlertBlock({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}

function SuccessBlock({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 text-xs text-success"
      role="status"
    >
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  );
}

function IssueList({ issues }: { issues: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {issues.map((issue) => (
        <li key={issue} className="font-mono text-[10px] leading-relaxed">
          {issue}
        </li>
      ))}
    </ul>
  );
}

function PathList({ paths }: { paths: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {paths.map((path) => (
        <li key={path} className="font-mono text-[10px] leading-relaxed">
          {path}
        </li>
      ))}
    </ul>
  );
}

export function BackupRestoreSection({ onRestored, onActivityChange }: BackupRestoreSectionProps) {
  const validateRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [targetDir, setTargetDir] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<BackupReport | null>(null);
  const [createError, setCreateError] = useState<unknown>(null);

  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<UiBackupValidationResult | null>(null);
  const [validateError, setValidateError] = useState<unknown>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);

  const [state, dispatch] = useReducer(restoreFlowReducer, initialRestoreFlow);
  const busy = state.phase === 'restoring';
  const active = creating || validating || previewing || busy;
  const source = state.source.trim();

  useEffect(() => {
    onActivityChange?.(active);
    return () => onActivityChange?.(false);
  }, [active, onActivityChange]);

  useEffect(() => {
    if (state.phase === 'confirming' || state.phase === 'failed') {
      confirmRef.current?.focus();
    }
  }, [state.phase]);

  function onSourceChange(value: string): void {
    // Invalidate responses for the previous source immediately. Clearing their
    // loading state also lets the user inspect the newly entered folder.
    validateRequestRef.current += 1;
    previewRequestRef.current += 1;
    dispatch({ type: 'edit-source', source: value });
    setValidating(false);
    setPreviewing(false);
    setValidateResult(null);
    setValidateError(null);
    setPreviewResult(null);
    setPreviewError(null);
  }

  async function runCreate(): Promise<void> {
    const target = targetDir.trim();
    if (target === '' || creating) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    try {
      setCreateResult(await api.createBackup({ targetDir: target }));
    } catch (error) {
      setCreateError(error);
    } finally {
      setCreating(false);
    }
  }

  async function runValidate(): Promise<void> {
    if (source === '' || validating) return;
    const request = ++validateRequestRef.current;
    const requestedSource = source;
    setValidating(true);
    setValidateError(null);
    setValidateResult(null);
    try {
      const result = await api.validateBackup({ dir: requestedSource });
      if (isBackupRequestCurrent(request, validateRequestRef.current)) setValidateResult(result);
    } catch (error) {
      if (isBackupRequestCurrent(request, validateRequestRef.current)) setValidateError(error);
    } finally {
      if (isBackupRequestCurrent(request, validateRequestRef.current)) setValidating(false);
    }
  }

  async function runPreview(): Promise<void> {
    if (source === '' || previewing) return;
    const request = ++previewRequestRef.current;
    const requestedSource = source;
    setPreviewing(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const result = await api.previewRestore({ dir: requestedSource });
      if (isBackupRequestCurrent(request, previewRequestRef.current)) setPreviewResult(result);
    } catch (error) {
      if (isBackupRequestCurrent(request, previewRequestRef.current)) setPreviewError(error);
    } finally {
      if (isBackupRequestCurrent(request, previewRequestRef.current)) setPreviewing(false);
    }
  }

  async function runRestore(): Promise<void> {
    if (busy) return;
    dispatch({ type: 'start' });
    try {
      const report = await api.restoreBackup({ dir: source, overwrite: state.overwrite });
      setPreviewResult(null);
      dispatch({ type: 'succeed', report });
      onRestored();
    } catch (error) {
      dispatch({ type: 'fail', error });
      if (error instanceof ApiError && error.code === 'PARTIAL_WRITE') onRestored();
    }
  }

  return (
    <section className="border-t py-5" aria-label="Backup and restore">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        <Archive className="size-3.5" />
        <h2 className="text-[13px] font-semibold text-foreground">Backup &amp; restore</h2>
      </div>
      <p className="mb-4 max-w-[68ch] text-[11px] leading-relaxed text-muted-foreground">
        Copy this vault into a backup folder, check an existing backup, and merge one back into the
        active vault. All paths go only to the local Nodus server.
      </p>

      <div className="space-y-4">
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold">Create backup</h3>
          <label
            className="text-[11px] font-medium text-muted-foreground"
            htmlFor="backup-target"
          >
            Backup folder
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="backup-target"
              value={targetDir}
              onChange={(event) => {
                setTargetDir(event.target.value);
                setCreateResult(null);
                setCreateError(null);
              }}
              placeholder="/absolute/path/to/backup"
              spellCheck={false}
              disabled={creating || busy}
              className="h-8 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => void runCreate()}
              disabled={creating || busy || targetDir.trim() === ''}
            >
              {creating ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Creating…
                </>
              ) : (
                'Create backup'
              )}
            </Button>
          </div>
          <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
            Must be an absolute folder outside the active vault and inside an allowed backup root
            (default: the vault&apos;s parent folder). Set <code>NODUS_BACKUP_ROOTS</code> (a{' '}
            <code>PATH</code>-delimited list) to allow more roots. Nodus has no file picker for
            backup folders — type the path.
          </p>
          {createResult === null ? null : (
            <SuccessBlock>
              <span>
                Backed up to <span className="font-mono break-all">{createResult.targetDir}</span>
              </span>
              <span className="block">{formatCounts(createResult)} saved.</span>
            </SuccessBlock>
          )}
          {createError === null ? null : (
            <AlertBlock>
              <span>{errorMessage(createError)}</span>
              {issuesOf(createError) === undefined ? null : <IssueList issues={issuesOf(createError)!} />}
            </AlertBlock>
          )}
        </div>

        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold">Check an existing backup</h3>
          <label className="text-[11px] font-medium text-muted-foreground" htmlFor="backup-source">
            Backup folder
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="backup-source"
              value={state.source}
              onChange={(event) => onSourceChange(event.target.value)}
              placeholder="/absolute/path/to/backup"
              spellCheck={false}
              disabled={busy}
              className="h-8 font-mono text-[11px]"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runValidate()}
                disabled={busy || validating || source === ''}
              >
                {validating ? 'Validating…' : 'Validate'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runPreview()}
                disabled={busy || previewing || source === ''}
              >
                {previewing ? 'Previewing…' : 'Preview'}
              </Button>
            </div>
          </div>
          <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
            Validate runs the same checks restore uses; an invalid backup is refused by restore
            too. Preview compares the backup with the live vault — read-only, it never modifies
            either. Because the vault can change afterwards, a clean preview does not guarantee a
            conflict-free restore.
          </p>
          {validateResult === null ? null : (
            <SuccessBlock>
              <span className="font-semibold">Valid backup.</span>
              <span className="block">
                {formatCounts(validateResult.counts)} (
                {validateResult.manifest.files.length} files, created{' '}
                <span className="font-mono">{validateResult.manifest.createdAt}</span>
                {validateResult.manifest.app === undefined
                  ? ''
                  : ` by ${validateResult.manifest.app.name} ${validateResult.manifest.app.version}`}
                ).
              </span>
            </SuccessBlock>
          )}
          {validateError === null ? null : (
            <AlertBlock>
              <span className="font-semibold">Validation failed — not restorable.</span>
              <span className="block">{errorMessage(validateError)}</span>
              {issuesOf(validateError) === undefined ? null : (
                <IssueList issues={issuesOf(validateError)!} />
              )}
            </AlertBlock>
          )}
          {previewResult === null ? null : previewHasConflicts(previewResult) ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
              role="status"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 space-y-1.5">
                <span className="font-semibold">
                  Preview: conflicts detected. A restore without overwrite would stop.
                </span>
                <span className="block">
                  {formatCounts(previewResult.counts)} in the backup.
                </span>
                {previewResult.conflicts.ids.length === 0 ? null : (
                  <div>
                    <div className="text-[11px] font-medium">
                      ID conflicts ({previewResult.conflicts.ids.length})
                    </div>
                    <ul className="mt-0.5 space-y-0.5">
                      {previewResult.conflicts.ids.map((id) => (
                        <li key={id} className="font-mono text-[10px] break-all">
                          {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {previewResult.conflicts.paths.length === 0 ? null : (
                  <div>
                    <div className="text-[11px] font-medium">
                      Path conflicts ({previewResult.conflicts.paths.length})
                    </div>
                    <ul className="mt-0.5 space-y-0.5">
                      {previewResult.conflicts.paths.map((path) => (
                        <li key={path} className="font-mono text-[10px] break-all">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <SuccessBlock>
              <span className="font-semibold">Preview: no conflicts.</span>
              <span className="block">
                {formatCounts(previewResult.counts)} would merge without overwriting anything.
              </span>
            </SuccessBlock>
          )}
          {previewError === null ? null : (
            <AlertBlock>
              <span>Preview failed.</span>
              <span className="block">{errorMessage(previewError)}</span>
              {issuesOf(previewError) === undefined ? null : (
                <IssueList issues={issuesOf(previewError)!} />
              )}
            </AlertBlock>
          )}
        </div>

        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold">Restore</h3>
          {state.phase === 'editing' ? (
            <>
              <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
                Restoring merges the backup&apos;s notes and definitions into the active vault. It
                never replaces the whole vault and never deletes untouched items. Conflicting
                items are kept unless you deliberately enable overwrite during confirmation. Uses
                the backup folder entered above — you always review the exact source first.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => dispatch({ type: 'request-confirm' })}
                disabled={source === ''}
              >
                Review restore…
              </Button>
            </>
          ) : null}

          {state.phase === 'done' && state.report !== null ? (
            <>
              <SuccessBlock>
                <span className="font-semibold">Restore complete.</span>
                <span className="block">Merged {formatCounts(state.report)} into the vault.</span>
              </SuccessBlock>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'cancel' })}
              >
                Start over
              </Button>
            </>
          ) : null}

          {state.phase === 'confirming' ||
          state.phase === 'restoring' ||
          state.phase === 'failed' ? (
            <div
              ref={confirmRef}
              tabIndex={-1}
              className="space-y-2.5 rounded-md border bg-muted/40 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/80"
              role="group"
              aria-label="Confirm restore"
            >
              <div className="text-xs font-semibold">Restore from this folder?</div>
              <div className="font-mono text-[10.5px] break-all">{state.source}</div>
              <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
                The backup&apos;s notes and definitions are merged into the active vault. Exact-path
                note replacement needs the same ID; case-insensitive or normalized path collisions
                stay blocked. This is a merge, not a full vault replacement.
              </p>
              {state.failure === null ? null : state.failure.kind === 'partial-write' ? (
                <AlertBlock>
                  <span className="font-semibold">
                    {restoreFailureTitle(state.failure)}. This restore is NOT complete.
                  </span>
                  <span className="block">{state.failure.message}</span>
                  {state.failure.paths === undefined ? null : (
                    <div>
                      <div className="text-[11px] font-medium">
                        Completed paths and failed-operation path:
                      </div>
                      <PathList paths={state.failure.paths} />
                    </div>
                  )}
                  <span className="block">
                    Restore did not roll back these changes. Inspect the vault and create a backup
                    before manual recovery. Do not retry blindly; current files may have changed.
                  </span>
                </AlertBlock>
              ) : (
                <AlertBlock>
                  <span className="font-semibold">{restoreFailureTitle(state.failure)}</span>
                  <span className="block">{state.failure.message}</span>
                  {state.failure.issues === undefined ? null : (
                    <IssueList issues={state.failure.issues} />
                  )}
                  {state.failure.kind === 'conflict' ? (
                    <span className="block">
                      Some matching-ID conflicts can be resolved with overwrite. Case-insensitive
                      or normalized path collisions stay blocked. Overwrite stays off until you
                      enable it, then retry.
                    </span>
                  ) : null}
                </AlertBlock>
              )}
              {state.failure?.kind !== 'conflict' ? null : (
                <div className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <Checkbox
                    id="restore-overwrite"
                    checked={state.overwrite}
                    onCheckedChange={(checked) =>
                      dispatch({ type: 'set-overwrite', value: checked === true })
                    }
                    disabled={busy}
                    className="mt-0.5"
                  />
                  <label htmlFor="restore-overwrite" className="cursor-pointer">
                    Overwrite existing notes and definitions that conflict (off by default)
                  </label>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {state.failure?.kind === 'partial-write' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: 'cancel' })}
                    disabled={busy}
                  >
                    Close and inspect vault
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => dispatch({ type: 'cancel' })}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void runRestore()}
                      disabled={busy}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                          Restoring…
                        </>
                      ) : state.overwrite ? (
                        'Restore with overwrite'
                      ) : state.phase === 'failed' ? (
                        'Retry restore'
                      ) : (
                        'Restore (merge)'
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
