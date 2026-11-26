import { describe, expect, it } from 'vitest';
import { ApiError } from '../ui/src/api.js';
import { decideRecoveredDateAction, isDefinitiveCreationRejection } from '../ui/src/calendarCreation.js';

describe('Calendar creation rejection classification', () => {
  it('treats validation and missing-target responses as definitive', () => {
    expect(isDefinitiveCreationRejection(new ApiError(400, 'INVALID_INPUT', 'title exceeds 200 characters'))).toBe(true);
    expect(isDefinitiveCreationRejection(new ApiError(404, 'NOT_FOUND', 'folder missing'))).toBe(true);
    expect(isDefinitiveCreationRejection(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'body too large'))).toBe(true);
    expect(isDefinitiveCreationRejection(new ApiError(422, 'STRUCTURED_DATA_INVALID', 'bad value'))).toBe(true);
  });

  it('keeps ambiguous failures and conflicting identities retryable', () => {
    expect(isDefinitiveCreationRejection(new ApiError(409, 'CONFLICT', 'different request'))).toBe(false);
    expect(isDefinitiveCreationRejection(new ApiError(500, 'STORAGE_FAILURE', 'disk error'))).toBe(false);
    expect(isDefinitiveCreationRejection(new TypeError('Failed to fetch'))).toBe(false);
    expect(isDefinitiveCreationRejection(undefined)).toBe(false);
  });
});

describe('recovered Calendar date reconciliation', () => {
  it('writes the original intent only when the note has no date yet', () => {
    expect(decideRecoveredDateAction(undefined, false, '2028-02-29')).toBe('write-intended-date');
    expect(decideRecoveredDateAction(null, false, '2028-02-29')).toBe('write-intended-date');
  });

  it('keeps an identical manual date without a second write', () => {
    expect(decideRecoveredDateAction('2028-02-29', false, '2028-02-29')).toBe('keep-current-date');
  });

  it('never overwrites a newer manually assigned date', () => {
    expect(decideRecoveredDateAction('2028-03-01', false, '2028-02-29')).toBe('conflict');
  });

  it('treats an invalid stored date as a conflict', () => {
    expect(decideRecoveredDateAction('not-a-date', true, '2028-02-29')).toBe('conflict');
    expect(decideRecoveredDateAction('2028-02-29', true, '2028-02-29')).toBe('conflict');
  });
});
