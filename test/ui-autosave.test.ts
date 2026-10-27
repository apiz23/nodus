import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, scheduleAutosave } from '../ui/src/scheduleAutosave.js';

describe('scheduleAutosave', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for the debounce interval before saving', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    scheduleAutosave(save);

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
  });

  it('cancels a pending save when the draft changes or becomes invalid', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const cancel = scheduleAutosave(save);

    cancel();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
  });
});
