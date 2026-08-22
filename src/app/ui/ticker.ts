import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { QITS_SCHEDULER } from './scheduler';

/**
 * A clock, as a signal, for the durations that grow while you watch them.
 *
 * A running step's elapsed time is computed from `startedAt` against *now* — it is not polled, and
 * must not be: re-reading a run to learn what a subtraction already knows would turn every card on
 * the board into traffic every second. Everything the server can change comes from the poll; this
 * only moves the second hand.
 *
 * It ticks through `QITS_SCHEDULER` rather than `setInterval`, so a spec drives the clock by hand
 * instead of waiting for one. Must be called in an injection context, which is what gives it the
 * `DestroyRef` that stops it.
 */
export function tickingNow(intervalMs = 1000): Signal<number> {
  const scheduler = inject(QITS_SCHEDULER);
  const now = signal(scheduler.now());
  const stop = scheduler.every(intervalMs, () => now.set(scheduler.now()));
  inject(DestroyRef).onDestroy(stop);
  return now.asReadonly();
}
