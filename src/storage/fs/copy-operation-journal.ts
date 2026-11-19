import { writeFileAtomicExclusive } from './atomic.js';
import { TEMP_PREFIX } from './layout.js';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir, lstat, open, opendir } from 'node:fs/promises';
import type { Dir, Dirent } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isUuidV4 as isDomainUuidV4 } from '../../domain/ids.js';
import { isTimestamp as isNoteTimestamp } from '../../domain/note.js';
import { validateNotePath } from '../../domain/paths.js';
import type { CopyOperationStatus, CopyOperationStatusState } from '../contracts.js';
import { StorageError } from '../errors.js';

export const COPY_OPERATION_JOURNAL_DIR = '.nodus-copy-journal';
const IDENTITY_FILE = 'vault.json';
const OPERATIONS_DIR = 'operations';
const RECORD_BYTES_MAX = 1024 * 1024;
const RECORDS_PER_OPERATION_MAX = 6;
const REPORT_ISSUES_MAX = 32;
const DEFAULT_SCAN_BUDGET_MS = 10_000;
const DEFAULT_SCAN_MAX_ENTRIES = 50_000;

export interface CopyJournalBudget {
  count: number;
  readonly max?: number;
  readonly check?: () => void;
}

export type CopyOperationState = 'Prepared' | 'Publishing' | 'Published' | 'Succeeded' | 'Failed' | 'NeedsReview' | 'Cancelled';

export interface CopyOperationPlanInput {
  readonly previewTokenSha256: string;
  readonly previewBindingSha256: string;
  readonly snapshotSha256: string;
  readonly confirmedAt: string;
  readonly source: {
    readonly id: string;
    readonly path: string;
    readonly rawSha256: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly destination: {
    readonly path: string;
    readonly collisionKey: string;
  };
  readonly copy: {
    readonly id: string;
    readonly instant: string;
    readonly serializedSha256: string;
    readonly serializedBytes: number;
    readonly noteFormatVersion: number;
  };
  readonly resolverProjectionSha256: string;
}

export interface CopyOperationPlan extends CopyOperationPlanInput {
  readonly format: 'nodus-copy-operation-plan';
  readonly version: 1;
  readonly operationId: string;
  readonly vaultInstanceId: string;
  readonly vaultLineageId: string;
}

export interface CopyOperationRecoveryReport {
  readonly scanned: number;
  readonly prepared: number;
  readonly terminal: number;
  readonly needsReview: number;
  readonly unresolved: boolean;
  readonly issues: readonly string[];
  readonly issuesTruncated: boolean;
}

interface VaultIdentity {
  readonly format: 'nodus-copy-journal-vault';
  readonly version: 1;
  readonly vaultInstanceId: string;
  readonly vaultLineageId: string;
  readonly createdAt: string;
  readonly sha256: string;
}

interface JournalEvent {
  readonly format: 'nodus-copy-operation-event';
  readonly version: 1;
  readonly operationId: string;
  readonly vaultInstanceId: string;
  readonly vaultLineageId: string;
  readonly sequence: number;
  readonly state: CopyOperationState;
  readonly recordedAt: string;
  readonly previousSha256: string | null;
  readonly plan?: CopyOperationPlan;
  readonly evidence?: Record<string, unknown>;
  readonly sha256: string;
}

interface OperationInspection {
  readonly operationId: string;
  readonly state: CopyOperationState | 'Corrupt';
  readonly plan?: CopyOperationPlan;
  readonly events: readonly JournalEvent[];
  readonly issue?: string;
}

export type CopyJournalFaultPoint =
  | 'after-journal-directory-created'
  | 'after-operations-directory-created'
  | 'after-vault-identity-created'
  | 'after-operation-directory-created'
  | 'before-cancellation-publish'
  | 'after-record-created'
  | 'after-record-written'
  | 'before-record-file-sync'
  | 'after-record-file-sync'
  | 'before-directory-sync'
  | 'after-record-directory-sync'
  | 'before-record-readback'
  | 'before-record-cleanup-close'
  | 'after-operations-root-enumerated';

/** Test-only interruption seam. FileSystemVault never supplies this callback. */
export type CopyJournalFaultInjector = (point: CopyJournalFaultPoint, path: string) => void | Promise<void>;

/**
 * Append-only journal for use only inside the accepted root-lock boundary.
 * It deliberately has no cleanup, overwrite, publication, or source-delete API.
 */
export class CopyOperationJournal {
  readonly #root: string;
  readonly #inject?: CopyJournalFaultInjector;
  readonly #budget: CopyJournalBudget;

  constructor(root: string, options: { faultInjector?: CopyJournalFaultInjector; budget?: CopyJournalBudget } = {}) {
    this.#root = root;
    this.#inject = options.faultInjector;
    const deadline = performance.now() + DEFAULT_SCAN_BUDGET_MS;
    this.#budget = options.budget ?? {
      count: 0,
      max: DEFAULT_SCAN_MAX_ENTRIES,
      check: () => {
        if (performance.now() >= deadline) throw new StorageError('CONFLICT', 'Copy journal scan exceeded its cooperative time budget');
      },
    };
  }

  /** Must be called while holding withVaultRootLock for this root. */
  async assertNoUnresolved(): Promise<void> {
    let unresolved: string | undefined;
    await this.visitOperations(async (operation) => {
      if (unresolved !== undefined) return false;
      if (operation.state === 'Corrupt') {
        unresolved = `${operation.operationId}: ${operation.issue ?? 'corrupt journal evidence'}`;
        return false;
      }
      if (!isResolvedCopyOperationState(operation.state)) {
        unresolved = `${operation.operationId}: ${operation.state}`;
        return false;
      }
      return true;
    });
    if (unresolved !== undefined) {
      throw new StorageError('PARTIAL_WRITE', `An unresolved or corrupt note-copy operation blocks this action: ${unresolved}. Preserve the journal for recovery review.`, {
        path: COPY_OPERATION_JOURNAL_DIR,
        details: { paths: [COPY_OPERATION_JOURNAL_DIR] },
      });
    }
  }

  /** Must be called while holding withVaultRootLock for this root. */
  async prepare(input: CopyOperationPlanInput): Promise<{ operationId: string; state: 'Prepared' }> {
    validatePlanInput(input);
    const identity = await this.ensureIdentity();
    await this.assertNoUnresolved();

    let duplicateToken = false;
    await this.visitOperations(async (operation) => {
      if (operation.state === 'Corrupt') throw corruptError(operation.operationId, operation.issue ?? 'invalid journal');
      if (operation.plan?.previewTokenSha256 === input.previewTokenSha256) duplicateToken = true;
      return true;
    });
    if (duplicateToken) throw new StorageError('CONFLICT', 'This preview token is already bound to a journal operation');

    const operationId = randomUUID();
    const plan: CopyOperationPlan = Object.freeze({
      format: 'nodus-copy-operation-plan', version: 1, operationId,
      vaultInstanceId: identity.vaultInstanceId, vaultLineageId: identity.vaultLineageId,
      previewTokenSha256: input.previewTokenSha256,
      previewBindingSha256: input.previewBindingSha256,
      snapshotSha256: input.snapshotSha256,
      confirmedAt: input.confirmedAt,
      source: Object.freeze({ ...input.source }),
      destination: Object.freeze({ ...input.destination }),
      copy: Object.freeze({ ...input.copy }),
      resolverProjectionSha256: input.resolverProjectionSha256,
    });
    validatePlan(plan);

    const operationsPath = join(this.#root, COPY_OPERATION_JOURNAL_DIR, OPERATIONS_DIR);
    const operationPath = join(operationsPath, operationId);
    await this.makeDirectory(operationPath, operationsPath, 'after-operation-directory-created');
    const event = makeEvent({
      operationId, vaultInstanceId: identity.vaultInstanceId, vaultLineageId: identity.vaultLineageId,
      sequence: 0, state: 'Prepared', recordedAt: new Date().toISOString(),
      previousSha256: null, plan,
    });
    await this.writeEvent(operationPath, event);
    const verified = await this.inspectOperation(operationId, operationPath, identity);
    if (verified.state !== 'Prepared' || verified.plan === undefined || verified.events.length !== 1) {
      throw corruptError(operationId, verified.issue ?? 'new plan did not verify after durable write');
    }
    return { operationId, state: 'Prepared' };
  }

  /**
   * Reconciles journal state without publishing or deleting anything. Prepared
   * records are validated by the storage owner; any publication state becomes
   * NeedsReview because there is no qualified publisher or recovery verifier.
   * Succeeded and Failed chains are preserved unchanged and remain unresolved:
   * this implementation writes neither and cannot verify their effects.
   */
  async recover(validatePrepared: (plan: CopyOperationPlan) => Promise<boolean>): Promise<CopyOperationRecoveryReport> {
    const counters = { scanned: 0, prepared: 0, terminal: 0, needsReview: 0, unresolved: false, issues: [] as string[], issuesTruncated: false };
    const identity = await this.readIdentity();
    if (identity === undefined) {
      await this.visitOperations(async () => true); // Detect orphaned operation evidence without an identity.
      return Object.freeze({ ...counters, issues: Object.freeze([]) });
    }
    const journalRoot = join(this.#root, COPY_OPERATION_JOURNAL_DIR);
    const operationsPath = join(journalRoot, OPERATIONS_DIR);
    // Once an identity exists, a missing operations directory is missing
    // evidence, not an empty journal. Recovery must never recreate it.
    await this.assertOperationsDirectory(journalRoot);
    // A prior write may have returned an error after the identity or operation
    // directory became visible but before its parent entry was synced. Re-sync
    // the complete directory chain before treating readable evidence as durable.
    await syncFile(join(journalRoot, IDENTITY_FILE));
    await this.syncDurableDirectory(journalRoot);
    await this.syncDurableDirectory(operationsPath);

    await this.visitOperations(async (operation) => {
      counters.scanned += 1;
      if (operation.state === 'Corrupt') {
        counters.needsReview += 1;
        counters.unresolved = true;
        appendIssue(counters, `${operation.operationId}: ${operation.issue ?? 'corrupt journal evidence'}`);
        return true;
      }

      if (operation.state === 'Prepared') {
        try {
          await this.syncOperationRecords(operation);
        } catch (error) {
          counters.needsReview += 1;
          counters.unresolved = true;
          appendIssue(counters, `${operation.operationId}: existing records could not be re-synced; evidence was left unchanged (${describe(error)})`);
          return true;
        }
        this.checkBudget();
        let valid = false;
        if (operation.plan !== undefined) {
          try { valid = await validatePrepared(operation.plan); }
          catch (error) {
            appendIssue(counters, `${operation.operationId}: prepared evidence could not be revalidated (${describe(error)})`);
          }
        }
        // The storage validator may itself perform bounded reads. Do not keep
        // invoking it for a large foreign journal after the shared deadline.
        this.checkBudget();
        if (!valid) {
          try {
            await this.appendTransitionUnlocked(operation, 'NeedsReview', {
              kind: 'review-required',
              reason: 'PREPARED_EVIDENCE_CHANGED_OR_UNAVAILABLE',
              observedAt: new Date().toISOString(),
            });
            counters.needsReview += 1;
            counters.unresolved = true;
            appendIssue(counters, `${operation.operationId}: prepared source or destination evidence changed; journal preserved for review`);
          } catch (error) {
            counters.needsReview += 1;
            counters.unresolved = true;
            appendIssue(counters, `${operation.operationId}: could not durably record recovery review state (${describe(error)})`);
          }
        } else {
          counters.prepared += 1;
          counters.unresolved = true;
        }
        return true;
      }

      if (operation.state === 'Publishing' || operation.state === 'Published') {
        try {
          await this.appendTransitionUnlocked(operation, 'NeedsReview', {
            kind: 'review-required',
            reason: 'PUBLICATION_RECOVERY_NOT_AVAILABLE',
            observedAt: new Date().toISOString(),
          });
        } catch (error) {
          appendIssue(counters, `${operation.operationId}: recovery could not append NeedsReview (${describe(error)})`);
        }
        counters.needsReview += 1;
        counters.unresolved = true;
        appendIssue(counters, `${operation.operationId}: publication state requires manual review; no filesystem artifact was changed`);
        return true;
      }

      if (operation.state === 'NeedsReview') {
        counters.needsReview += 1;
        counters.unresolved = true;
        appendIssue(counters, `${operation.operationId}: remains NeedsReview; evidence was not changed`);
        return true;
      }

      // Succeeded and Failed chains are structurally valid but unsupported:
      // this implementation writes neither, and neither the terminal receipt
      // nor the no-effect proof can be independently verified against the
      // filesystem. Their evidence must be retained and must keep blocking
      // admission, exactly as the public status already reports.
      if (operation.state === 'Succeeded' || operation.state === 'Failed') {
        counters.needsReview += 1;
        counters.unresolved = true;
        appendIssue(counters, `${operation.operationId}: unsupported ${operation.state} event has no verifiable filesystem effect; evidence was left unchanged`);
        return true;
      }

      if (isResolvedCopyOperationState(operation.state)) {
        counters.terminal += 1;
        return true;
      }

      // Any future, otherwise unclassified state stays unresolved and blocks.
      counters.needsReview += 1;
      counters.unresolved = true;
      appendIssue(counters, `${operation.operationId}: ${operation.state} has no established resolution contract; evidence was left unchanged`);
      return true;
    });

    return Object.freeze({ ...counters, issues: Object.freeze([...counters.issues]) });
  }

  async cancel(operationId: string, proveNoEffect: (plan: CopyOperationPlan) => Promise<boolean>) {
    if (!isUuidV4(operationId)) throw new StorageError('INVALID_INPUT', 'Invalid copy operation ID.');
    let selected: OperationInspection | undefined;
    await this.visitOperations(async (operation) => {
      if (operation.state === 'Corrupt') throw corruptError(operation.operationId, operation.issue ?? 'invalid evidence');
      if (operation.operationId === operationId) selected = operation;
      else if (!isResolvedCopyOperationState(operation.state)) throw corruptError(operation.operationId, 'another operation is unresolved');
      return true;
    });
    const operation = selected;
    if (!operation) throw new StorageError('NOT_FOUND', 'Copy operation was not found.');
    if (operation.state === 'Cancelled') {
      await this.syncOperationRecords(operation);
      return { operationId, state: 'Cancelled' as const, alreadyCancelled: true };
    }
    if (operation.state !== 'Prepared' || !operation.plan || !(await proveNoEffect(operation.plan))) {
      throw corruptError(operationId, 'no-effect cancellation cannot be established');
    }
    await this.appendTransitionUnlocked(operation, 'Cancelled', { kind: 'no-publication' });
    return { operationId, state: 'Cancelled' as const, alreadyCancelled: false };
  }

  async list() {
    const statuses: CopyOperationStatus[] = [];
    await this.visitOperations(async (operation) => {
      const { operationId, state, plan, issue } = operation;
      statuses.push({
        operationId,
        state: toPublicCopyOperationState(state),
        ...(plan ? { sourcePath: plan.source.path, destinationPath: plan.destination.path } : {}),
        ...(issue ? { issue } : {}),
      });
    });
    return statuses;
  }

  private async appendTransitionUnlocked(operation: OperationInspection, state: CopyOperationState, evidence: Record<string, unknown>): Promise<void> {
    const current = operation.state;
    if (current === 'Corrupt' || !isLegalCopyOperationTransition(current, state)) {
      throw new StorageError('CONFLICT', `Illegal copy journal transition: ${current} -> ${state}`, { path: `${COPY_OPERATION_JOURNAL_DIR}/${operation.operationId}` });
    }
    validateTransitionEvidence(state, evidence);
    const identity = await this.readIdentity();
    if (!identity) throw corruptError(operation.operationId, 'vault identity is missing');
    const previous = operation.events.at(-1);
    if (!previous) throw corruptError(operation.operationId, 'operation has no durable plan record');
    validateTransitionAgainstPlan(previous, state, evidence, operation.plan as CopyOperationPlan | undefined);
    // Never extend a chain whose earlier bytes or directory entries have not
    // been re-established as durable after a prior interrupted write.
    await this.syncOperationRecords(operation);
    const event = makeEvent({
      operationId: operation.operationId, vaultInstanceId: identity.vaultInstanceId,
      vaultLineageId: identity.vaultLineageId, sequence: previous.sequence + 1,
      state, recordedAt: new Date().toISOString(), previousSha256: previous.sha256, evidence,
    });
    const directory = join(this.#root, COPY_OPERATION_JOURNAL_DIR, OPERATIONS_DIR, operation.operationId);
    if (state === 'Cancelled') {
      const eventPath = join(directory, eventFilename(event.sequence));
      const bytes = encodeJson(event);
      try {
        // Hard-link publication is atomic and refuses to replace an event that
        // appeared after inspection. Keep this exclusive behavior local to the
        // journal transition; ordinary atomic replacement remains unchanged.
        await writeFileAtomicExclusive(eventPath, bytes, {
          beforePublish: (temporaryPath) => this.inject('before-cancellation-publish', temporaryPath),
        });
        await this.syncDurableDirectory(directory);
        const published = await readBoundedFile(eventPath, RECORD_BYTES_MAX);
        const info = await lstat(eventPath);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
          || info.size !== bytes.byteLength || !Buffer.from(published).equals(Buffer.from(bytes))) {
          throw corruptError(eventPath, 'cancellation event read-back differs from the exclusively published record');
        }
      } catch (error) {
        throw new StorageError('PARTIAL_WRITE', `Cancellation event was not confirmed durable; preserve the journal for inspection: ${describe(error)}`, {
          cause: error,
          path: `${COPY_OPERATION_JOURNAL_DIR}/${OPERATIONS_DIR}/${operation.operationId}/${eventFilename(event.sequence)}`,
          details: { paths: [`${COPY_OPERATION_JOURNAL_DIR}/${OPERATIONS_DIR}/${operation.operationId}`] },
        });
      }
    } else await this.writeEvent(directory, event);
  }

  private async ensureIdentity(): Promise<VaultIdentity> {
    this.checkBudget();
    const journalRoot = join(this.#root, COPY_OPERATION_JOURNAL_DIR);
    await this.makeDirectory(journalRoot, this.#root, 'after-journal-directory-created');
    const identityPath = join(journalRoot, IDENTITY_FILE);
    try {
      const identity = await this.readIdentity();
      if (identity) {
        // Existing identity means the journal has already been initialized.
        // Do not repair a missing operations directory: it may represent lost
        // operation evidence and must fail closed.
        await this.assertOperationsDirectory(journalRoot);
        return identity;
      }
    } catch (error) {
      throw error;
    }

    const operationsPath = join(journalRoot, OPERATIONS_DIR);
    const operationsInfo = await this.lstatOrMissing(operationsPath);
    if (operationsInfo) {
      if (operationsInfo.isSymbolicLink() || !operationsInfo.isDirectory()) throw corruptError(OPERATIONS_DIR, 'operations path is not a regular directory');
      const first = await this.firstDirectoryEntry(operationsPath);
      if (first !== undefined) throw corruptError(first, 'operation evidence exists without a vault identity; preserve it');
    }

    const instanceId = randomUUID();
    const body = {
      format: 'nodus-copy-journal-vault' as const,
      version: 1 as const,
      vaultInstanceId: instanceId,
      vaultLineageId: instanceId,
      createdAt: new Date().toISOString(),
    };
    const identity: VaultIdentity = Object.freeze({ ...body, sha256: sha256Hex(JSON.stringify(body)) });
    await this.writeUniqueFile(identityPath, encodeJson(identity), 'after-vault-identity-created');
    await this.ensureOperationsDirectory(journalRoot);
    return identity;
  }

  private async ensureOperationsDirectory(journalRoot: string): Promise<void> {
    await this.makeDirectory(join(journalRoot, OPERATIONS_DIR), journalRoot, 'after-operations-directory-created');
    await this.assertOperationsDirectory(journalRoot);
  }

  private async assertOperationsDirectory(journalRoot: string): Promise<void> {
    const operationsPath = join(journalRoot, OPERATIONS_DIR);
    const info = await this.lstatOrMissing(operationsPath);
    if (!info || info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0) {
      throw corruptError(OPERATIONS_DIR, 'operations directory is missing or unsafe beside an existing vault identity');
    }
    const names = await this.readDirectoryNames(journalRoot, 2);
    if (names.length !== 2 || !names.includes(IDENTITY_FILE) || !names.includes(OPERATIONS_DIR)) {
      throw corruptError(COPY_OPERATION_JOURNAL_DIR, 'journal root contains unrecognized entries');
    }
  }

  private async readIdentity(): Promise<VaultIdentity | undefined> {
    this.checkBudget();
    const journalRoot = join(this.#root, COPY_OPERATION_JOURNAL_DIR);
    const rootInfo = await this.lstatOrMissing(journalRoot);
    if (!rootInfo) return undefined;
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || (rootInfo.mode & 0o077) !== 0) throw corruptError(COPY_OPERATION_JOURNAL_DIR, 'journal root is not a private regular directory');
    const path = join(journalRoot, IDENTITY_FILE);
    const info = await this.lstatOrMissing(path);
    if (!info) return undefined;
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > 16 * 1024) throw corruptError(IDENTITY_FILE, 'vault identity file is unsafe, non-private, or oversized');
    const bytes = await readBoundedFile(path, 16 * 1024);
    const parsed = decodeJson(bytes, path);
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['format', 'version', 'vaultInstanceId', 'vaultLineageId', 'createdAt', 'sha256'])) throw corruptError(IDENTITY_FILE, 'vault identity schema is invalid');
    const { format, version, vaultInstanceId, vaultLineageId, createdAt, sha256 } = parsed;
    const body = { format, version, vaultInstanceId, vaultLineageId, createdAt };
    if (format !== 'nodus-copy-journal-vault' || version !== 1 || !isUuidV4(vaultInstanceId) || !isUuidV4(vaultLineageId)
      || !isTimestamp(createdAt) || !isSha256(sha256) || sha256Hex(JSON.stringify(body)) !== sha256) {
      throw corruptError(IDENTITY_FILE, 'vault identity checksum or fields are invalid');
    }
    return Object.freeze({ format, version, vaultInstanceId, vaultLineageId, createdAt, sha256 }) as VaultIdentity;
  }

  private async visitOperations(visitor: (operation: OperationInspection) => Promise<boolean | void>): Promise<void> {
    const identity = await this.readIdentity();
    if (!identity) {
      const rootPath = join(this.#root, COPY_OPERATION_JOURNAL_DIR);
      const rootInfo = await this.lstatOrMissing(rootPath);
      if (!rootInfo) return;
      const names = await this.readDirectoryNames(rootPath, 2);
      if (names.some((name) => name !== OPERATIONS_DIR) || names.length > 1) throw corruptError(COPY_OPERATION_JOURNAL_DIR, 'journal identity is missing beside existing evidence');
      const operationsPath = join(rootPath, OPERATIONS_DIR);
      const first = await this.firstDirectoryEntry(operationsPath);
      if (first !== undefined) throw corruptError(first, 'operation evidence exists without a vault identity');
      return;
    }
    const journalRoot = join(this.#root, COPY_OPERATION_JOURNAL_DIR);
    const rootNames = await this.readDirectoryNames(journalRoot, 2);
    if (!rootNames.includes(OPERATIONS_DIR)) {
      throw corruptError(OPERATIONS_DIR, 'operations directory is missing beside an existing vault identity');
    }
    if (rootNames.length !== 2 || !rootNames.includes(IDENTITY_FILE) || !rootNames.includes(OPERATIONS_DIR)) {
      throw corruptError(COPY_OPERATION_JOURNAL_DIR, 'journal root contains missing or unrecognized entries');
    }
    const operationsPath = join(journalRoot, OPERATIONS_DIR);
    await this.inject('after-operations-root-enumerated', operationsPath);
    const operationsInfo = await this.lstatOrMissing(operationsPath);
    if (!operationsInfo) throw corruptError(OPERATIONS_DIR, 'operations directory disappeared during journal inspection');
    if (operationsInfo.isSymbolicLink() || !operationsInfo.isDirectory() || (operationsInfo.mode & 0o077) !== 0) throw corruptError(OPERATIONS_DIR, 'operations path is not a private regular directory');

    await forEachDirectoryEntry(operationsPath, async (entry) => {
      this.checkBudget();
      this.chargeEntry();
      const operationId = entry.name;
      if (!isUuidV4(operationId) || entry.isSymbolicLink() || !entry.isDirectory()) {
        const keepGoing = await visitor({ operationId, state: 'Corrupt', events: [], issue: 'unrecognized operation entry; left untouched' });
        return keepGoing !== false;
      }
      const operationPath = join(operationsPath, operationId);
      let operation: OperationInspection;
      try { operation = await this.inspectOperation(operationId, operationPath, identity); }
      catch (error) { operation = { operationId, state: 'Corrupt', events: [], issue: describe(error) }; }
      this.checkBudget();
      const keepGoing = await visitor(operation);
      return keepGoing !== false;
    });
  }

  private async inspectOperation(operationId: string, operationPath: string, identity: Pick<VaultIdentity, 'vaultInstanceId' | 'vaultLineageId'>): Promise<OperationInspection> {
    const info = await this.lstatOrMissing(operationPath);
    if (!info || info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0) return { operationId, state: 'Corrupt', events: [], issue: 'operation path is missing or unsafe' };
    const names = await this.readDirectoryNames(operationPath, RECORDS_PER_OPERATION_MAX);
    if (names.length === 0) return { operationId, state: 'Corrupt', events: [], issue: 'operation directory contains no plan record' };
    const ordered = names.filter((name) => !(name.startsWith(TEMP_PREFIX) && isUuidV4(name.slice(TEMP_PREFIX.length)))).sort();
    const events: JournalEvent[] = [];
    let plan: CopyOperationPlan | undefined;
    for (let sequence = 0; sequence < ordered.length; sequence += 1) {
      const expectedName = eventFilename(sequence);
      if (ordered[sequence] !== expectedName) return { operationId, state: 'Corrupt', events, issue: 'event sequence contains an unknown file, duplicate, or gap' };
      const path = join(operationPath, expectedName);
      const parsed = await this.readEvent(path);
      if (parsed.operationId !== operationId || parsed.sequence !== sequence || parsed.vaultInstanceId !== identity.vaultInstanceId
        || parsed.vaultLineageId !== identity.vaultLineageId) {
        return { operationId, state: 'Corrupt', events, issue: 'event operation or vault identity does not match the active journal' };
      }
      if (sequence === 0) {
        if (parsed.state !== 'Prepared' || parsed.previousSha256 !== null || !parsed.plan || parsed.evidence !== undefined) {
          return { operationId, state: 'Corrupt', events, issue: 'first event is not an immutable Prepared plan' };
        }
        validatePlan(parsed.plan);
        if (parsed.plan.operationId !== operationId || parsed.plan.vaultInstanceId !== identity.vaultInstanceId || parsed.plan.vaultLineageId !== identity.vaultLineageId) {
          return { operationId, state: 'Corrupt', events, issue: 'plan identity does not match its journal' };
        }
        plan = parsed.plan;
      } else {
        const previous = events[sequence - 1];
        if (!previous || parsed.previousSha256 !== previous.sha256 || parsed.plan !== undefined || parsed.evidence === undefined
          || !isLegalCopyOperationTransition(previous.state, parsed.state)) {
          return { operationId, state: 'Corrupt', events, issue: 'event chain or state transition is contradictory' };
        }
        validateTransitionEvidence(parsed.state, parsed.evidence);
        validateTransitionAgainstPlan(previous, parsed.state, parsed.evidence, plan);
      }
      events.push(parsed);
    }
    const last = events.at(-1);
    if (!last || !plan) return { operationId, state: 'Corrupt', events, issue: 'journal plan is incomplete' };
    return { operationId, state: last.state, plan, events };
  }

  private async readEvent(path: string): Promise<JournalEvent> {
    const bytes = await readBoundedFile(path, RECORD_BYTES_MAX);
    const value = decodeJson(bytes, path);
    if (!isRecord(value) || !hasOnlyKeys(value, ['format', 'version', 'operationId', 'vaultInstanceId', 'vaultLineageId', 'sequence', 'state', 'recordedAt', 'previousSha256', 'plan', 'evidence', 'sha256'])) {
      throw corruptError(path, 'event schema contains unknown fields');
    }
    const event = value as unknown as JournalEvent;
    if (event.format !== 'nodus-copy-operation-event' || (event.version !== 1) || !isUuidV4(event.operationId)
      || !isUuidV4(event.vaultInstanceId) || !isUuidV4(event.vaultLineageId)
      || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || !isCopyOperationState(event.state)
      || !isTimestamp(event.recordedAt) || !(event.previousSha256 === null || isSha256(event.previousSha256)) || !isSha256(event.sha256)) {
      throw corruptError(path, 'event fields are invalid');
    }
    const canonical = eventBody(event);
    if (sha256Hex(JSON.stringify(canonical)) !== event.sha256) throw corruptError(path, 'event checksum is invalid');
    return event;
  }

  private async writeEvent(directory: string, event: JournalEvent): Promise<void> {
    this.checkBudget();
    const bytes = encodeJson(event);
    if (bytes.byteLength > RECORD_BYTES_MAX) throw new StorageError('INVALID_CONTENT', 'Copy journal record exceeds the 1 MiB record limit');
    await this.writeUniqueFile(join(directory, eventFilename(event.sequence)), bytes, 'after-record-created');
  }

  private async writeUniqueFile(path: string, bytes: Uint8Array, afterCreated: CopyJournalFaultPoint): Promise<void> {
    this.checkBudget();
    if (bytes.byteLength > RECORD_BYTES_MAX) throw new StorageError('INVALID_CONTENT', 'Copy journal record exceeds the 1 MiB record limit');
    let handle: FileHandle | undefined;
    let primary: unknown;
    let failed = false;
    try {
      handle = await open(path, 'wx', 0o600);
      this.checkBudget();
      await this.inject(afterCreated, path);
      await handle.writeFile(bytes);
      this.checkBudget();
      const owned = await handle.stat();
      if (!owned.isFile() || owned.nlink !== 1 || (owned.mode & 0o077) !== 0 || owned.size !== bytes.byteLength) {
        throw corruptError(path, 'new journal file is not the expected private single-link regular file');
      }
      if (afterCreated === 'after-record-created') await this.inject('after-record-written', path);
      if (afterCreated === 'after-record-created') await this.inject('before-record-file-sync', path);
      await handle.sync();
      this.checkBudget();
      if (afterCreated === 'after-record-created') await this.inject('after-record-file-sync', path);
      await handle.close();
      handle = undefined;
      await this.syncDurableDirectory(dirname(path));
      this.checkBudget();
      if (afterCreated === 'after-record-created') await this.inject('after-record-directory-sync', path);
      if (afterCreated === 'after-record-created') await this.inject('before-record-readback', path);
      const readback = await readBoundedFile(path, RECORD_BYTES_MAX);
      const named = await lstat(path);
      if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || (named.mode & 0o077) !== 0
        || named.dev !== owned.dev || named.ino !== owned.ino || named.size !== owned.size
        || !Buffer.from(readback).equals(Buffer.from(bytes))) throw corruptError(path, 'durable record read-back differs from the exclusively created file');
    } catch (error) {
      failed = true;
      primary = error;
    }
    if (handle !== undefined) {
      let cleanupError: unknown;
      let cleanupFailed = false;
      try { await this.inject('before-record-cleanup-close', path); }
      catch (error) { cleanupFailed = true; cleanupError = error; }
      try { await handle.close(); }
      catch (error) {
        cleanupError = cleanupFailed ? new AggregateError([cleanupError, error], 'Injected and filesystem handle cleanup failed') : error;
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        if (failed) throw new AggregateError([primary, cleanupError], 'Copy journal write and handle cleanup failed');
        throw cleanupError;
      }
    }
    if (failed) throw primary;
  }

  private async makeDirectory(path: string, parent: string, point: CopyJournalFaultPoint): Promise<void> {
    this.checkBudget();
    const existing = await this.lstatOrMissing(path);
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory() || (existing.mode & 0o077) !== 0) throw corruptError(path, 'journal directory is not private and regular');
      await this.syncDurableDirectory(parent);
      return;
    }
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const raced = await this.lstatOrMissing(path);
      if (!raced || raced.isSymbolicLink() || !raced.isDirectory() || (raced.mode & 0o077) !== 0) throw corruptError(path, 'journal directory changed during creation');
      await this.syncDurableDirectory(parent);
      return;
    }
    await this.inject(point, path);
    await this.syncDurableDirectory(parent);
  }

  private async syncDurableDirectory(path: string): Promise<void> {
    let handle: FileHandle | undefined;
    let primary: unknown;
    let failed = false;
    try {
      const before = await lstat(path);
      if (before.isSymbolicLink() || !before.isDirectory()) throw corruptError(path, 'directory to sync is not regular');
      handle = await open(path, 'r');
      const opened = await handle.stat();
      if (!opened.isDirectory() || before.dev !== opened.dev || before.ino !== opened.ino) throw corruptError(path, 'directory identity changed while opening for sync');
      await this.inject('before-directory-sync', path);
      await handle.sync();
      const after = await handle.stat();
      const named = await lstat(path);
      if (!after.isDirectory() || after.dev !== opened.dev || after.ino !== opened.ino || !named.isDirectory() || named.isSymbolicLink()
        || named.dev !== opened.dev || named.ino !== opened.ino) {
        throw corruptError(path, 'directory identity changed while syncing');
      }
    } catch (error) {
      failed = true;
      primary = error;
    }
    if (handle !== undefined) {
      try { await handle.close(); }
      catch (cleanupError) {
        if (failed) throw new AggregateError([primary, cleanupError], `Directory sync and close failed for ${path}`);
        throw cleanupError;
      }
    }
    if (failed) throw new StorageError('STORAGE_FAILURE', `Required journal directory sync failed for ${path}`, { path, cause: primary });
  }

  private async syncOperationRecords(operation: OperationInspection): Promise<void> {
    const directory = join(this.#root, COPY_OPERATION_JOURNAL_DIR, OPERATIONS_DIR, operation.operationId);
    for (const event of operation.events) await syncFile(join(directory, eventFilename(event.sequence)));
    await this.syncDurableDirectory(directory);
  }

  private async lstatOrMissing(path: string) {
    try { return await lstat(path); }
    catch (error) { if (isMissing(error)) return undefined; throw error; }
  }

  private async readDirectoryNames(path: string, maximum: number): Promise<string[]> {
    const names: string[] = [];
    await forEachDirectoryEntry(path, async (entry) => {
      this.chargeEntry();
      if (names.length >= maximum) throw corruptError(path, `directory exceeds its ${maximum}-entry structural bound`);
      names.push(entry.name);
      return true;
    });
    return names;
  }

  private async firstDirectoryEntry(path: string): Promise<string | undefined> {
    const info = await this.lstatOrMissing(path);
    if (!info) return undefined;
    if (info.isSymbolicLink() || !info.isDirectory()) throw corruptError(path, 'expected a regular directory');
    let first: string | undefined;
    await forEachDirectoryEntry(path, async (entry) => { this.chargeEntry(); first = entry.name; return false; });
    return first;
  }

  private checkBudget(): void { this.#budget.check?.(); }

  private chargeEntry(): void {
    this.checkBudget();
    if (this.#budget.max !== undefined && this.#budget.count >= this.#budget.max) {
      throw new StorageError('INVALID_CONTENT', 'Copy journal discovery exceeds the shared entry budget');
    }
    this.#budget.count += 1;
    this.checkBudget();
  }

  private async inject(point: CopyJournalFaultPoint, path: string): Promise<void> {
    await this.#inject?.(point, path);
  }
}

export function isLegalCopyOperationTransition(from: CopyOperationState, to: CopyOperationState): boolean {
  switch (from) {
    case 'Prepared': return to === 'Cancelled' || to === 'Publishing' || to === 'Failed' || to === 'NeedsReview';
    case 'Publishing': return to === 'Published' || to === 'Failed' || to === 'NeedsReview';
    case 'Published': return to === 'Succeeded' || to === 'NeedsReview';
    case 'Cancelled': case 'Succeeded': case 'Failed': case 'NeedsReview': return false;
  }
}

function validatePlanInput(value: CopyOperationPlanInput): void {
  if (!isRecord(value) || !isSha256(value.previewTokenSha256) || !isSha256(value.previewBindingSha256)
    || !isSha256(value.snapshotSha256) || !isTimestamp(value.confirmedAt) || !isRecord(value.source)
    || !hasOnlyKeys(value as unknown as Record<string, unknown>, ['previewTokenSha256', 'previewBindingSha256', 'snapshotSha256', 'confirmedAt', 'source', 'destination', 'copy', 'resolverProjectionSha256'])
    || !isRecord(value.destination) || !isRecord(value.copy) || !isSha256(value.resolverProjectionSha256)
    || !hasOnlyKeys(value.source, ['id', 'path', 'rawSha256', 'createdAt', 'updatedAt'])
    || !hasOnlyKeys(value.destination, ['path', 'collisionKey'])
    || !hasOnlyKeys(value.copy, ['id', 'instant', 'serializedSha256', 'serializedBytes', 'noteFormatVersion'])) {
    throw new StorageError('INVALID_INPUT', 'Copy operation plan evidence is incomplete');
  }
  if (!isUuidV4(value.source.id) || validatePath(value.source.path) === undefined || !isSha256(value.source.rawSha256)
    || !isTimestamp(value.source.createdAt) || !isTimestamp(value.source.updatedAt)
    || validatePath(value.destination.path) === undefined || value.destination.path === value.source.path || value.destination.collisionKey !== foldPath(value.destination.path)
    || !isUuidV4(value.copy.id) || value.copy.id === value.source.id || !isTimestamp(value.copy.instant)
    || !isSha256(value.copy.serializedSha256) || !Number.isSafeInteger(value.copy.serializedBytes) || value.copy.serializedBytes < 0 || value.copy.serializedBytes > 32 * 1024 * 1024
    || !Number.isSafeInteger(value.copy.noteFormatVersion) || value.copy.noteFormatVersion < 1) {
    throw new StorageError('INVALID_INPUT', 'Copy operation plan contains invalid source, destination, or copy identity evidence');
  }
}

function validatePlan(value: unknown): asserts value is CopyOperationPlan {
  if (!isRecord(value) || !hasOnlyKeys(value, ['format', 'version', 'operationId', 'vaultInstanceId', 'vaultLineageId', 'previewTokenSha256', 'previewBindingSha256', 'snapshotSha256', 'confirmedAt', 'source', 'destination', 'copy', 'resolverProjectionSha256'])) {
    throw corruptError('plan', 'plan schema contains unknown fields');
  }
  if (value.format !== 'nodus-copy-operation-plan' || value.version !== 1 || !isUuidV4(value.operationId)
    || !isUuidV4(value.vaultInstanceId) || !isUuidV4(value.vaultLineageId)) throw corruptError('plan', 'plan version or identity is invalid');
  try {
    validatePlanInput({
      previewTokenSha256: value.previewTokenSha256 as string,
      previewBindingSha256: value.previewBindingSha256 as string,
      snapshotSha256: value.snapshotSha256 as string,
      confirmedAt: value.confirmedAt as string,
      source: value.source as CopyOperationPlanInput['source'],
      destination: value.destination as CopyOperationPlanInput['destination'],
      copy: value.copy as CopyOperationPlanInput['copy'],
      resolverProjectionSha256: value.resolverProjectionSha256 as string,
    });
  }
  catch (error) { throw corruptError('plan', describe(error)); }
}

function validateTransitionEvidence(state: CopyOperationState, value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, evidenceKeys(state))) throw corruptError('transition', `evidence fields for ${state} are invalid`);
  if (state === 'Cancelled') {
    if (value.kind !== 'no-publication') throw corruptError('transition', 'invalid cancellation evidence');
  } else if (state === 'Publishing') {
    if (value.kind !== 'publication-intent' || validatePath(value.destinationPath) === undefined || !isSha256(value.expectedSha256)) throw corruptError('transition', 'publication intent is invalid');
  } else if (state === 'Published') {
    if (value.kind !== 'publication-receipt' || validatePath(value.destinationPath) === undefined || !isSha256(value.sha256)
      || !isIdentityString(value.dev) || !isIdentityString(value.ino) || !isSha256(value.ownershipEvidenceSha256)) throw corruptError('transition', 'publication receipt is invalid');
  } else if (state === 'Succeeded') {
    if (value.kind !== 'terminal-receipt' || !isSha256(value.publishedEventSha256)) throw corruptError('transition', 'terminal receipt is invalid');
  } else if (state === 'Failed') {
    if (value.kind !== 'no-effect-proof' || !isRecord(value.source) || !hasOnlyKeys(value.source, ['path', 'rawSha256'])
      || validatePath(value.source.path) === undefined || !isSha256(value.source.rawSha256)
      || !isRecord(value.destination) || !hasOnlyKeys(value.destination, ['path', 'absent'])
      || validatePath(value.destination.path) === undefined || value.destination.absent !== true
      || value.stagingAbsent !== true || !isTimestamp(value.observedAt) || !isSha256(value.proofSha256)
      || sha256Hex(JSON.stringify({
        source: { path: value.source.path, rawSha256: value.source.rawSha256 },
        destination: { path: value.destination.path, absent: value.destination.absent },
        stagingAbsent: value.stagingAbsent,
        observedAt: value.observedAt,
      })) !== value.proofSha256) throw corruptError('transition', 'Failed requires a structured no-effects proof');
  } else if (state === 'NeedsReview') {
    if (value.kind !== 'review-required' || typeof value.reason !== 'string' || value.reason.length === 0 || !isTimestamp(value.observedAt)) throw corruptError('transition', 'NeedsReview evidence is invalid');
  } else {
    throw corruptError('transition', 'Prepared is only valid as the initial event');
  }
}

function validateTransitionAgainstPlan(
  previous: JournalEvent,
  state: CopyOperationState,
  evidence: Record<string, unknown>,
  plan: CopyOperationPlan | undefined,
): void {
  if (!plan) throw corruptError('transition', 'operation plan is unavailable');
  if (state === 'Publishing' && (evidence.destinationPath !== plan.destination.path || evidence.expectedSha256 !== plan.copy.serializedSha256)) {
    throw corruptError('transition', 'publication intent differs from the immutable plan');
  }
  if (state === 'Published' && (evidence.destinationPath !== plan.destination.path || evidence.sha256 !== plan.copy.serializedSha256)) {
    throw corruptError('transition', 'publication receipt differs from the immutable plan');
  }
  if (state === 'Failed' && (!isRecord(evidence.source) || evidence.source.path !== plan.source.path
    || evidence.source.rawSha256 !== plan.source.rawSha256 || !isRecord(evidence.destination)
    || evidence.destination.path !== plan.destination.path)) {
    throw corruptError('transition', 'no-effects proof differs from the immutable plan');
  }
  if (state === 'Succeeded' && (previous.state !== 'Published' || evidence.publishedEventSha256 !== previous.sha256)) {
    throw corruptError('transition', 'terminal receipt does not bind to the immediately preceding publication receipt');
  }
}

function evidenceKeys(state: CopyOperationState): string[] {
  switch (state) {
    case 'Publishing': return ['kind', 'destinationPath', 'expectedSha256'];
    case 'Published': return ['kind', 'destinationPath', 'sha256', 'dev', 'ino', 'ownershipEvidenceSha256'];
    case 'Succeeded': return ['kind', 'publishedEventSha256'];
    case 'Failed': return ['kind', 'source', 'destination', 'stagingAbsent', 'observedAt', 'proofSha256'];
    case 'NeedsReview': return ['kind', 'reason', 'observedAt'];
    case 'Prepared': return [];
    case 'Cancelled': return ['kind'];
  }
}

function makeEvent(input: Omit<JournalEvent, 'format' | 'version' | 'sha256'> & { readonly sha256?: string }): JournalEvent {
  const body = {
    format: 'nodus-copy-operation-event' as const,
    version: 1 as const,
    operationId: input.operationId,
    vaultInstanceId: input.vaultInstanceId,
    vaultLineageId: input.vaultLineageId,
    sequence: input.sequence,
    state: input.state,
    recordedAt: input.recordedAt,
    previousSha256: input.previousSha256,
    ...(input.plan === undefined ? {} : { plan: input.plan }),
    ...(input.evidence === undefined ? {} : { evidence: canonicalEvidence(input.evidence) }),
  };
  return Object.freeze({ ...body, sha256: sha256Hex(JSON.stringify(body)) });
}

function eventBody(event: JournalEvent): Record<string, unknown> {
  return {
    format: event.format,
    version: event.version,
    operationId: event.operationId,
    vaultInstanceId: event.vaultInstanceId,
    vaultLineageId: event.vaultLineageId,
    sequence: event.sequence,
    state: event.state,
    recordedAt: event.recordedAt,
    previousSha256: event.previousSha256,
    ...(event.plan === undefined ? {} : { plan: canonicalPlan(event.plan) }),
    ...(event.evidence === undefined ? {} : { evidence: canonicalEvidence(event.evidence) }),
  };
}

function canonicalPlan(plan: CopyOperationPlan): CopyOperationPlan {
  return {
    format: plan.format, version: plan.version, operationId: plan.operationId,
    vaultInstanceId: plan.vaultInstanceId, vaultLineageId: plan.vaultLineageId,
    previewTokenSha256: plan.previewTokenSha256, previewBindingSha256: plan.previewBindingSha256,
    snapshotSha256: plan.snapshotSha256, confirmedAt: plan.confirmedAt,
    source: { id: plan.source.id, path: plan.source.path, rawSha256: plan.source.rawSha256, createdAt: plan.source.createdAt, updatedAt: plan.source.updatedAt },
    destination: { path: plan.destination.path, collisionKey: plan.destination.collisionKey },
    copy: { id: plan.copy.id, instant: plan.copy.instant, serializedSha256: plan.copy.serializedSha256, serializedBytes: plan.copy.serializedBytes, noteFormatVersion: plan.copy.noteFormatVersion },
    resolverProjectionSha256: plan.resolverProjectionSha256,
  };
}

function canonicalEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(evidence).sort();
  return Object.fromEntries(keys.map((key) => [key, evidence[key]]));
}

async function readBoundedFile(path: string, maximum: number): Promise<Buffer> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  let failed = false;
  let result: Buffer | undefined;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || before.size > maximum) throw corruptError(path, 'journal file is unsafe, non-private, or oversized');
    handle = await open(path, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o077) !== 0 || before.dev !== opened.dev || before.ino !== opened.ino || opened.size > maximum) throw corruptError(path, 'journal file identity changed while opening');
    const bytes = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(bytes, 0, maximum + 1, 0);
    const after = await handle.stat();
    const named = await lstat(path);
    if (bytesRead > maximum || bytesRead !== after.size || after.size !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || named.isSymbolicLink() || !named.isFile() || named.nlink !== 1 || (named.mode & 0o077) !== 0
      || named.dev !== opened.dev || named.ino !== opened.ino) throw corruptError(path, 'journal file changed or exceeded its read bound');
    result = bytes.subarray(0, bytesRead);
  } catch (error) {
    failed = true;
    primary = error;
  }
  if (handle !== undefined) {
    try { await handle.close(); }
    catch (cleanupError) {
      if (failed) throw new AggregateError([primary, cleanupError], `Journal read and handle cleanup failed for ${path}`);
      throw cleanupError;
    }
  }
  if (failed) throw primary;
  return result!;
}

async function syncFile(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  let failed = false;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0) throw corruptError(path, 'journal file to sync is unsafe');
    handle = await open(path, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o077) !== 0 || before.dev !== opened.dev || before.ino !== opened.ino) {
      throw corruptError(path, 'journal file identity changed while opening for sync');
    }
    await handle.sync();
    const after = await handle.stat();
    const named = await lstat(path);
    if (!after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || !named.isFile() || named.isSymbolicLink()
      || named.nlink !== 1 || (named.mode & 0o077) !== 0 || named.dev !== opened.dev || named.ino !== opened.ino) {
      throw corruptError(path, 'journal file identity changed while syncing');
    }
  } catch (error) { failed = true; primary = error; }
  if (handle !== undefined) {
    try { await handle.close(); }
    catch (cleanupError) {
      if (failed) throw new AggregateError([primary, cleanupError], `Journal file sync and close failed for ${path}`);
      throw cleanupError;
    }
  }
  if (failed) throw new StorageError('STORAGE_FAILURE', `Required journal file sync failed for ${path}`, { path, cause: primary });
}

async function forEachDirectoryEntry(path: string, visit: (entry: Dirent) => Promise<boolean>): Promise<void> {
  let directory: Dir | undefined;
  let primary: unknown;
  let failed = false;
  try {
    directory = await opendir(path);
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      if (!(await visit(entry))) break;
    }
  } catch (error) { failed = true; primary = error; }
  if (directory !== undefined) {
    try { await directory.close(); }
    catch (cleanupError) {
      if (failed) throw new AggregateError([primary, cleanupError], `Journal directory read and close failed for ${path}`);
      throw cleanupError;
    }
  }
  if (failed) throw primary;
}

function decodeJson(bytes: Buffer, path: string): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw corruptError(path, 'journal data is not valid UTF-8'); }
  try { return JSON.parse(text) as unknown; }
  catch { throw corruptError(path, 'journal JSON is truncated or malformed'); }
}

function encodeJson(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'); }
function eventFilename(sequence: number): string { return `event-${String(sequence).padStart(6, '0')}.json`; }
function sha256Hex(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function isUuidV4(value: unknown): value is string { return typeof value === 'string' && isDomainUuidV4(value); }
function isCopyOperationState(value: unknown): value is CopyOperationState { return value === 'Cancelled' || value === 'Prepared' || value === 'Publishing' || value === 'Published' || value === 'Succeeded' || value === 'Failed' || value === 'NeedsReview'; }

/**
 * The single semantic interpretation of journal evidence shared by status
 * reporting, admission, cancellation and recovery.
 *
 * Only Cancelled is a supported resolved outcome: cancellation requires proof
 * that no filesystem effect exists before the event is written and revalidates
 * that proof on retry. Succeeded and Failed chains are structurally valid, but
 * no reconstructed M1–M5 implementation writes them and no verifier can confirm
 * their filesystem effects, so they remain unresolved and must block.
 */
function isResolvedCopyOperationState(state: CopyOperationState | 'Corrupt'): boolean {
  return state === 'Cancelled';
}

/** Public status never reports an unverifiable outcome as resolved. */
function toPublicCopyOperationState(state: CopyOperationState | 'Corrupt'): CopyOperationStatusState {
  if (state === 'Publishing' || state === 'Published' || state === 'Succeeded' || state === 'Failed') return 'NeedsReview';
  return state;
}
function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  if (isNoteTimestamp(value)) return true;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}
function isIdentityString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 64; }
function validatePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { return validateNotePath(value); } catch { return undefined; }
}
function foldPath(value: string): string { return value.normalize('NFC').toLowerCase(); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'; }
function isAlreadyExists(error: unknown): boolean { return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST'; }
function corruptError(path: string, message: string): StorageError { return new StorageError('PARTIAL_WRITE', `Copy journal evidence at "${path}" is unsafe or corrupt: ${message}. Preserve it for manual inspection.`, { path }); }
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function appendIssue(report: { issues: string[]; issuesTruncated: boolean }, issue: string): void {
  if (report.issues.length < REPORT_ISSUES_MAX) report.issues.push(issue);
  else report.issuesTruncated = true;
}
