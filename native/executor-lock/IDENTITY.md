# Executor lock identity contract (H1)

The vault root is canonicalized by the TypeScript entry point. Each acquisition
retains a directory handle and a persistent regular lock-file handle. POSIX
opens the basename relative to the directory descriptor with no-follow and
nonblocking flags. The file must be owned by the effective user, have mode 0600,
one hard link, and share the retained directory's device. The vault directory
must be owned by that user and must not be group/world writable. No permissions
or existing contents are repaired automatically.

Named file device/inode and directory device/inode are checked before and after
POSIX lock acquisition. Filesystem qualification uses the acquired descriptors.
Windows retains non-delete-shared file and directory handles, rejects reparse
points, requires a disk file and one hard link, compares volume/file identities,
and checks NTFS through the acquired file handle. Windows ACL ownership policy
is not yet implemented or verified; Windows remains unaccepted.

Use lease.withOwnership() for protected operations and retain the lease
throughout them. A failed validation requires stopping; release still closes the
original handles. inspectExecutorOwnership() is only a momentary observation,
not authorization for subsequent mutation. Neither API currently runs automation.

All cooperating Nodus processes must use this fixed file and never unlink,
rename, replace, or migrate it while executors may exist. External writers must
leave the vault directory hierarchy and lock pathname stable. POSIX cannot stop
another same-user process from replacing them: a second process may acquire a
replacement inode before the first owner revalidates. Revalidation detects
observed changes but cannot close the interval between validation and mutation.
A replacement completed before acquisition has no trusted historical identity;
it cannot be distinguished from a legitimate file without an additional durable
identity protocol. H1 makes no such claim. Ancestor changes and mount changes
also require a quiescent vault; arbitrary external filesystem mutation is outside
this coordination contract.

The existing filesystem allowlist is unchanged. Linux ext-family magic does not
prove ext4 specifically, and filesystem type alone does not prove a folder is
not cloud-synchronized. Qualification and packaging remain separate acceptance
gates. No journal, execution integration, or automatic recovery is introduced.

## Lease lifecycle (F1/F2)

Acquisition classifications describe the acquisition instant only. The lease has
no ownership classification field. Its read-only state is active, invalidated,
releasing, or released. Active means the lease remains eligible for identity validation,
not that identity has been continuously verified. For protected work use withOwnership(callback); standalone validation is diagnostic only.

Any identity-validation failure permanently invalidates the lease, including a
missing validation backend. Restoring paths cannot reactivate it. Only release
is permitted afterward. Native handles also retain permanent invalidation.
Release changes state to releasing immediately and to released before cleanup; it is allowed from active or invalidated. Repeated release calls return the same promise and outcome,
including the original cleanup failure. Released describes ended authorization;
it does not certify successful cleanup when release rejected. No retry of
native cleanup occurs through this lease. Acquisition failures retain existing
native cleanup behavior. Ownership inspection remains momentary and cannot
authorize a future mutation.

## Serialized protected operations

withOwnership validates synchronously immediately before entering one callback.
Concurrent or nested protected operations are rejected, not queued. The callback
owns the operation slot until its returned promise settles. Callers must await
all work they start; detached asynchronous work is outside the contract.

Release immediately closes admission (releasing), waits for the running callback,
then changes to released and attempts native cleanup. It never unlocks beneath
that callback. Repeated release calls share the same promise, including errors.
Do not await release from inside the protected callback: it waits for that same
callback to finish. Use runWithExecutorOwnership at the outer, single-use owner boundary.

Standalone validation is rejected while a callback runs; it cannot invalidate
an unrelated running callback. Failed entry validation permanently invalidates
the lease and never invokes the callback. External identity changes during an
async callback cannot be preemptively detected or safely cancel arbitrary work;
the stable external-writer assumptions above remain required. Callback exceptions
propagate unchanged and do not alone invalidate identity. Cleanup errors belong
to the release promise, separately from callback results.

## Owner boundary and backend admission

runWithExecutorOwnership(lease, callback) runs scoped work and always releases.
It returns the callback result when both succeed, preserves the exact callback
error when only work fails, preserves the cleanup error when only cleanup fails,
and throws AggregateError([operationError, cleanupError]) when both fail. This
also preserves validation failures alongside cleanup failures. Do not duplicate
this logic using a throwing finally block. The helper consumes an exclusively
owned lease; it must not be called inside another protected callback or concurrently
with another owner helper on that lease.

Admission is reserved before calling the synchronous validation backend. Reentrant
operations or validation reject while admission is busy. Reentrant release closes
admission, drains validation, and prevents the outer callback from entering even
if the backend returns true. Lifecycle is checked again after validation without
an await. No native backend changes or asynchronous backend support are introduced.
The callback must await all protected work. Awaiting release inside that callback
is prohibited and not automatically detected; explicit lifetime rules avoid adding
async-context machinery. Detached work cannot extend the returned promise lifetime.

## F3 — Native Cleanup Diagnostics & Failure Handling

Explicit release attempts unlock (only if actually acquired), file close, and
retained-directory close independently. All observed failures are returned on an
ERR_LOCK_RELEASE error as cleanup.failures [{operation, code}], with path and
context. Codes are errno on POSIX and GetLastError on Windows. Errors propagate
unchanged through the owner helper, alongside callback errors where applicable.
No failed close is retried: descriptor reuse makes blind retry unsafe. Handles
are marked no longer reusable regardless of cleanup outcome. Released still
means authorization ended, not confirmed OS resource closure.

Acquisition/finalizer failures cannot replace the original acquisition error or
throw from GC. They are retained in readExecutorCleanupDiagnostics(): the last
32 failure records plus a dropped-record count, scoped to the addon environment.
Reads do not clear records. Diagnostics are memory-only, not a durable journal;
process exit or teardown can lose them. External-handle finalizers retain shared
ownership of the diagnostic sink and do not require JavaScript access during
cleanup. Successful cleanup emits no record. Finalizer execution timing is not a
prompt-release guarantee; explicit owner cleanup is required.

A separate executor_lock_test addon injects failure reports after real syscalls.
This verifies propagation, aggregation, bounded diagnostics, acquisition cleanup,
and repeat-call behavior, but does not simulate actual kernel close failure or
prove handle closure after such failure. The production addon has no fault setter.
Linux/Windows execution and GC-teardown fault coverage remain outstanding.
