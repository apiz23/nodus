import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Archive, CheckCircle2, Loader2 } from 'lucide-react';
import type {
  BackupReport,
  ExportReport,
  ImportPreviewResponse,
  ImportExecutionReport,
  ImportOperationStatus,
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

function pathsOf(error: unknown): string[] | undefined {
  return error instanceof ApiError && error.paths !== undefined && error.paths.length > 0
    ? error.paths
    : undefined;
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

function importResourceKey(resource: { kind: string; id: string; path: string }): string {
  return JSON.stringify([resource.kind, resource.id, resource.path]);
}

export function BackupRestoreSection({ onRestored, onActivityChange }: BackupRestoreSectionProps) {
  const validateRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [targetDir, setTargetDir] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<BackupReport | null>(null);
  const [createError, setCreateError] = useState<unknown>(null);
  const [portableTarget, setPortableTarget] = useState('');
  const [exporting, setExporting] = useState(false);
  const [portableResult, setPortableResult] = useState<ExportReport | null>(null);
  const [portableError, setPortableError] = useState<unknown>(null);
  const [importSource, setImportSource] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null);
  const [importPreviewError, setImportPreviewError] = useState<unknown>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importDecisionChoices, setImportDecisionChoices] = useState<Record<string, 'add' | 'skip' | 'replace'>>({});
  const [importReplacingConfirmed, setImportReplacingConfirmed] = useState(false);
  const [importExecuting, setImportExecuting] = useState(false);
  const [importExecution, setImportExecution] = useState<ImportExecutionReport | null>(null);
  const [importExecutionError, setImportExecutionError] = useState<unknown>(null);
  const [importOperations, setImportOperations] = useState<ImportOperationStatus[]>([]);
  const [importRecoveryBusy, setImportRecoveryBusy] = useState<string | null>(null);
  const [importRecoveryResult, setImportRecoveryResult] = useState<string | null>(null);

  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<UiBackupValidationResult | null>(null);
  const [validateError, setValidateError] = useState<unknown>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);

  const [state, dispatch] = useReducer(restoreFlowReducer, initialRestoreFlow);
  const busy = state.phase === 'restoring';
  const active = creating || exporting || validating || previewing || importPreviewing || importExecuting || importRecoveryBusy !== null || busy;
  const source = state.source.trim();

  useEffect(() => {
    onActivityChange?.(active);
    return () => onActivityChange?.(false);
  }, [active, onActivityChange]);

  useEffect(() => {
    let current = true;
    void api.listImportOperations().then(({ operations }) => { if (current) setImportOperations(operations); }).catch((error: unknown) => { if (current) setImportExecutionError(error); });
    return () => { current = false; };
  }, []);

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

  async function runPortableExport(): Promise<void> {
    const target = portableTarget.trim();
    if (target === '' || exporting) return;
    setExporting(true);
    setPortableError(null);
    setPortableResult(null);
    try {
      setPortableResult(await api.createPortableExport({ targetDir: target }));
    } catch (error) {
      setPortableError(error);
    } finally {
      setExporting(false);
    }
  }

  async function runImportPreview(): Promise<void> {
    const source = importSource.trim();
    if (!source || importPreviewing) return;
    setImportPreviewing(true); setImportPreviewError(null); setImportPreview(null); setImportExecution(null); setImportExecutionError(null); setImportDecisionChoices({}); setImportReplacingConfirmed(false);
    try {
      const preview = await api.previewImport({ dir: source });
      setImportPreview(preview);
      setImportDecisionChoices(Object.fromEntries(preview.resources.map((resource) => [importResourceKey(resource), resource.status === 'new' ? 'add' : 'skip'])));
    }
    catch (error) { setImportPreviewError(error); }
    finally { setImportPreviewing(false); }
  }

  async function refreshImportOperations(): Promise<void> {
    try { setImportOperations((await api.listImportOperations()).operations); }
    catch { /* Preserve the primary execution/recovery error; the next panel mount retries. */ }
  }

  async function runImportExecution(): Promise<void> {
    if (!importPreview || importExecuting || !importPreview.previewId) return;
    const decisions = importPreview.resources.map((resource) => ({ ...resource, choice: importDecisionChoices[importResourceKey(resource)] }));
    if (decisions.some((decision) => decision.choice === undefined) || decisions.some((decision) => decision.choice === 'replace') && !importReplacingConfirmed) return;
    setImportExecuting(true); setImportExecutionError(null); setImportExecution(null);
    try {
      const report = await api.executeImport({ previewId: importPreview.previewId, confirm: true, decisions: decisions.map(({ kind, id, path, choice }) => ({ kind, id, path, choice: choice! })) });
      setImportExecution(report);
      setImportOperations((previous) => [{ operationId: report.operationId, state: report.state === 'completed' ? 'committed' : report.state, startedAt: report.startedAt, updatedAt: report.completedAt, resources: report.resources.filter((resource) => resource.status !== 'skipped').map(({ kind, id, path, decision }) => ({ kind, id, path, decision: decision as 'add' | 'replace', publication: 'published' })) }, ...previous.filter((item) => item.operationId !== report.operationId)]);
      setImportPreview(null);
      onRestored();
    } catch (error) { setImportExecutionError(error); setImportPreview(null); await refreshImportOperations(); }
    finally { setImportExecuting(false); }
  }

  async function runImportRecovery(operationId: string): Promise<void> {
    if (importRecoveryBusy) return;
    setImportRecoveryBusy(operationId); setImportExecutionError(null); setImportRecoveryResult(null);
    try {
      const status = await api.recoverImportOperation(operationId);
      setImportOperations((previous) => previous.map((item) => item.operationId === operationId ? status : item));
      setImportRecoveryResult(status.failure?.code === 'STAGING_INTERRUPTED'
        ? `Import recovery ${status.state} · operation ${operationId}. The interruption happened before publication; no destination resources were changed.`
        : `Import recovery ${status.state} · operation ${operationId}. Files changed outside this operation were preserved.`);
      onRestored();
    } catch (error) { setImportExecutionError(error); await refreshImportOperations(); }
    finally { setImportRecoveryBusy(null); }
  }

  async function runImportRetry(operationId: string): Promise<void> {
    if (importRecoveryBusy) return;
    setImportRecoveryBusy(operationId); setImportExecutionError(null);
    try {
      const report = await api.retryImportOperation(operationId);
      setImportExecution(report);
      setImportOperations((previous) => previous.map((item) => item.operationId === operationId ? { ...item, state: 'committed', updatedAt: report.completedAt, resources: item.resources.map((resource) => ({ ...resource, publication: resource.decision === 'skip' ? 'skipped' : 'published' })) } : item));
      onRestored();
    } catch (error) { setImportExecutionError(error); await refreshImportOperations(); }
    finally { setImportRecoveryBusy(null); }
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
        <div className="space-y-2.5 rounded-md border p-3">
          <h3 className="text-xs font-semibold">Portable export</h3>
          <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
            Create a vault-shaped folder with a versioned integrity manifest for moving this workspace. This is separate from a recovery backup; unsupported files are listed in the result.
          </p>
          <label className="text-[11px] font-medium text-muted-foreground" htmlFor="portable-export-target">Export folder</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="portable-export-target" value={portableTarget} onChange={(event) => { setPortableTarget(event.target.value); setPortableResult(null); setPortableError(null); }} placeholder="/absolute/path/to/export" spellCheck={false} disabled={exporting || busy} className="h-8 font-mono text-[11px]" />
            <Button type="button" size="sm" className="shrink-0" onClick={() => void runPortableExport()} disabled={exporting || busy || portableTarget.trim() === ''}>
              {exporting ? <><Loader2 className="animate-spin" data-icon="inline-start" />Exporting…</> : 'Export workspace'}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Use an absolute folder outside the vault and inside an allowed backup root. The destination must be empty. This runtime accepts a typed path and does not support cancellation.</p>
          {portableResult && <SuccessBlock><span>Portable export completed at <span className="font-mono break-all">{portableResult.targetDir}</span>.</span><span className="block">{portableResult.notes} notes, {portableResult.databases} databases, {portableResult.databaseViews} saved views, {portableResult.attachments ?? 0} attachments. Manifest {portableResult.manifest ?? 'nodus-export.json'} (v{portableResult.manifestVersion ?? 1}).</span></SuccessBlock>}
          {portableResult && (portableResult.excluded?.length ?? 0) > 0 && <div role="note" aria-label="Files omitted from portable export" className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"><span>{portableResult.excluded!.length} path(s) were not included:</span><IssueList issues={portableResult.excluded!.map((item) => `${item.path}: ${item.reason}`)} /></div>}
          {portableError !== null && <AlertBlock><span>{errorMessage(portableError)}</span>{issuesOf(portableError) === undefined ? null : <IssueList issues={issuesOf(portableError)!} />}</AlertBlock>}
        </div>

        <div className="space-y-2.5 rounded-md border p-3">
          <h3 className="text-xs font-semibold">Import workspace</h3>
          <p className="text-[11px] text-muted-foreground">Preview the package, review each resource, then confirm. The server validates the preview again before writing.</p>
          <label className="text-[11px] font-medium text-muted-foreground" htmlFor="portable-import-source">Source folder</label>
          <div className="flex flex-col gap-2 sm:flex-row"><Input id="portable-import-source" value={importSource} onChange={(event) => { setImportSource(event.target.value); setImportPreview(null); setImportPreviewError(null); setImportExecution(null); setImportExecutionError(null); setImportDecisionChoices({}); }} placeholder="/absolute/path/to/export" disabled={importPreviewing || importExecuting || busy} className="h-8 font-mono text-[11px]" /><Button type="button" size="sm" onClick={() => void runImportPreview()} disabled={importPreviewing || importExecuting || busy || importSource.trim() === ''}>{importPreviewing ? <><Loader2 className="animate-spin" data-icon="inline-start" />Previewing…</> : 'Preview import'}</Button></div>
          {importPreviewing && <p role="status" className="text-[11px] text-muted-foreground">Validating package and comparing resources…</p>}
          {importPreviewError !== null && <AlertBlock><span>{errorMessage(importPreviewError)}</span>{issuesOf(importPreviewError) === undefined ? null : <IssueList issues={issuesOf(importPreviewError)!} />}{pathsOf(importPreviewError) === undefined ? null : <PathList paths={pathsOf(importPreviewError)!} />}</AlertBlock>}
          {importPreview && <div className="space-y-3 text-[11px]"><div role="status" className="space-y-1"><p>{importPreview.completeness === 'manifest-validated' ? `Portable export v${importPreview.manifestVersion} manifest and inventory validated` : 'Legacy directory preview; recognized resources validated, completeness unverified'} — {importPreview.counts.notes} notes, {importPreview.counts.databases} databases, {importPreview.counts.databaseViews} views, {importPreview.counts.attachments} attachments, {importPreview.counts.otherResources} other resources.</p><p>{importPreview.resources.filter((resource) => resource.status === 'new').length} new · {importPreview.resources.filter((resource) => resource.status === 'identical').length} identical · {importPreview.conflicts.length} conflicts</p><p>Preview valid until {new Date(importPreview.expiresAt).toLocaleTimeString()}.</p></div>
            {importPreview.resources.length > 0 && <ul aria-label="Import resource decisions" className="max-h-72 space-y-2 overflow-auto rounded-md border p-2">{importPreview.resources.map((resource) => { const key = importResourceKey(resource); const choice = importDecisionChoices[key] ?? 'skip'; return <li key={key} className="rounded border p-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{resource.kind} · {resource.status}</span><span className="break-all font-mono text-muted-foreground">{resource.path}</span></div>{resource.reason && <p className="mt-1 text-destructive">{resource.reason}</p>}<div className="mt-2 flex flex-wrap gap-1" aria-label={`Actions for ${resource.kind} ${resource.id}`}>{resource.safeChoices.map((option) => <Button key={option} type="button" size="sm" variant={choice === option ? 'secondary' : 'outline'} aria-pressed={choice === option} onClick={() => { setImportDecisionChoices((previous) => ({ ...previous, [key]: option })); setImportReplacingConfirmed(false); }} disabled={importExecuting}>{option === 'add' ? 'Add' : option === 'replace' ? 'Replace' : 'Skip'}</Button>)}</div></li>; })}</ul>}
            {importPreview.warnings.map((warning) => <p key={warning} role="note" className="text-amber-700 dark:text-amber-300">{warning}</p>)}
            {importPreview.errors.map((error) => <p key={error} role="alert" className="text-destructive">{error}</p>)}
            {importPreview.resources.some((resource) => importDecisionChoices[importResourceKey(resource)] === 'replace') && <label className="flex items-start gap-2 rounded-md border border-destructive/30 p-2"><Checkbox checked={importReplacingConfirmed} onCheckedChange={(checked) => setImportReplacingConfirmed(checked === true)} disabled={importExecuting} /><span>I reviewed the listed destination files and explicitly approve replacing those exact resources.</span></label>}
            {importPreview.resources.length === 0 ? <p className="text-muted-foreground">This source contains no supported resources to import.</p> : <Button type="button" size="sm" onClick={() => void runImportExecution()} disabled={importExecuting || importPreview.resources.some((resource) => !resource.safeChoices.includes(importDecisionChoices[importResourceKey(resource)] ?? 'skip')) || importPreview.resources.some((resource) => importDecisionChoices[importResourceKey(resource)] === 'replace') && !importReplacingConfirmed}>{importExecuting ? <><Loader2 className="animate-spin" data-icon="inline-start" />Importing…</> : 'Confirm and import'}</Button>}
          </div>}
          {importExecuting && <p role="status" className="text-[11px] text-muted-foreground">Staging and publishing validated resources. Keep Nodus open until completion is reported.</p>}
          {importExecutionError !== null && <AlertBlock><span>{errorMessage(importExecutionError)}</span><Button type="button" size="sm" variant="outline" onClick={() => void runImportPreview()} disabled={importPreviewing || importExecuting}>Create a fresh preview</Button></AlertBlock>}
          {importExecution && <SuccessBlock><span>Import {importExecution.state} · operation {importExecution.operationId}</span><span className="block">{importExecution.resources.filter((resource) => resource.status === 'published').length} published, {importExecution.resources.filter((resource) => resource.status === 'skipped').length} skipped. Every published resource passed final checksum verification.</span></SuccessBlock>}
          {importRecoveryResult !== null && <SuccessBlock><span>{importRecoveryResult}</span></SuccessBlock>}
          {importOperations.some((operation) => operation.state === 'staging' || operation.state === 'publishing' || operation.state === 'recovery-required' || operation.state === 'staged' || operation.state === 'corrupt') && <div role="alert" className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px]"><p className="font-semibold">An import operation needs recovery or inspection.</p>{importOperations.filter((operation) => operation.state === 'staging' || operation.state === 'publishing' || operation.state === 'recovery-required' || operation.state === 'staged' || operation.state === 'corrupt').map((operation) => <div key={operation.operationId} className="flex flex-wrap items-center justify-between gap-2"><span>{operation.operationId} · {operation.state} · {operation.resources.length} resources</span>{operation.state !== 'corrupt' && <div className="flex flex-wrap gap-1">{(operation.state === 'publishing' || operation.state === 'recovery-required') && <Button type="button" size="sm" variant="outline" onClick={() => void runImportRetry(operation.operationId)} disabled={importRecoveryBusy !== null}>{importRecoveryBusy === operation.operationId ? <><Loader2 className="animate-spin" data-icon="inline-start" />Retrying…</> : 'Retry safely'}</Button>}<Button type="button" size="sm" variant="outline" onClick={() => void runImportRecovery(operation.operationId)} disabled={importRecoveryBusy !== null}>{importRecoveryBusy === operation.operationId ? <><Loader2 className="animate-spin" data-icon="inline-start" />Recovering…</> : operation.state === 'staging' ? 'Recover staging safely' : 'Roll back safely'}</Button></div>}</div>)}{importOperations.filter((operation) => operation.state === 'corrupt').map((operation) => <p key={operation.operationId}>{operation.failure?.message ?? 'Recovery journal is unreadable.'} Preserve recovery files and inspect manually.</p>)}<p>Retry revalidates every staged and destination resource. Rollback changes only files still proven to belong to this operation; ambiguous files are left untouched.</p></div>}
        </div>

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
              disabled={creating || exporting || busy || targetDir.trim() === ''}
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
