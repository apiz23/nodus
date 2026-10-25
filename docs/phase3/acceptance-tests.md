# Phase 3 Acceptance Tests

## Protocol and relay
- [x] Duplicate push returns stored result; no second revision.
- [x] Lost response recovered via `/operations`.
- [x] Stale `baseVersion` rejected with conflict status.
- [x] Retired-ID edit/create rejected and preserved as conflict copy.
- [x] Device sequence gap resolved from cached operation results.
- [x] Compaction past cursor returns `bootstrapRequired`.
- [x] Wrong vault/epoch forces bootstrap.
- [x] Revoked token rejected; reused pairing code rejected.
- [x] Invalid payload rejected with structured error.
- [x] Relay transaction rollback on crash/injected error.

## Local client crash safety
- [ ] Crash after local document write but before cursor update recovers.
- [ ] Crash between apply intent and rename recovers.
- [ ] Crash after rename but before apply-ledger commit recovers.
- [ ] Crash while creating conflict copy leaves exactly one copy.
- [ ] Concurrent local edits during remote apply produce conflict copy.
- [ ] Lost/corrupt local sync metadata triggers recovery/bootstrap, not mass deletion.

## Restore and epoch
- [ ] Old relay backup restored repeatedly increments epoch every time.
- [ ] Missing/corrupt epoch anchor mints new vault identity and requires bootstrap.
- [ ] Restore does not resurrect revoked credentials.

## Path and conflict safety
- [ ] Case-fold/NFC path collisions rejected.
- [ ] Occupied move destination rejected.
- [ ] Conflicting database definitions rejected for manual resolution.

## Backup validation
- [ ] Symlink outside backup root rejected.
- [ ] Non-regular backup entry rejected.
- [ ] Tampered archive, partial backup, and wrong key rejected.

## Regression
- [ ] All Phase 1 and Phase 2 tests still pass.
