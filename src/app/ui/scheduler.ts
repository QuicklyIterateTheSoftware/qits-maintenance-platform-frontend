import { InjectionToken } from '@angular/core';

/**
 * The two things this application asks the browser for that a spec cannot wait on: a repeating
 * timer, and the current time.
 *
 * **A seam, not a mock.** Both polling and the ticking duration are time-driven, and a spec that
 * asserted them by sleeping would be slow and flaky in equal measure. Injecting them means a spec
 * provides a scheduler it drives by hand — `tick()` — and every assertion about "after two seconds"
 * is exact. It is a DI token rather than a module-level `let` for the reason the platform's vitest
 * lesson records: a module patched with `vi.mock` leaks between spec files and makes green depend
 * on the order they ran in, while an injected seam is scoped to the `TestBed` that provided it.
 */
export interface QitsScheduler {
  /** Run `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** Milliseconds since the epoch. */
  now(): number;
}

/** The real one: the browser's own interval and clock. */
export const REAL_SCHEDULER: QitsScheduler = {
  every(ms, fn) {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
  now: () => Date.now(),
};

export const QITS_SCHEDULER = new InjectionToken<QitsScheduler>('qits.scheduler', {
  providedIn: 'root',
  factory: () => REAL_SCHEDULER,
});
