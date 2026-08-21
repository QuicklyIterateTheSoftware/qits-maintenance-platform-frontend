import type { QitsScheduler } from '../ui/scheduler';

/**
 * A clock the specs move by hand.
 *
 * Polling is the one behaviour on these pages that is defined in seconds, and a spec that waited
 * for real ones would be slow and flaky in the same breath. `fire(ms)` runs the tasks registered at
 * that interval, so "one poll happened" is an exact statement — and `count(ms)` is how "polling
 * stopped" is asserted, which is otherwise invisible.
 *
 * It is a class provided through `QITS_SCHEDULER` and never a `vi.mock`: a patched module leaks
 * between spec files and makes green depend on the order they ran in, while an injected seam is
 * scoped to the `TestBed` that provided it.
 */
export class ManualScheduler implements QitsScheduler {
  private readonly tasks = new Map<number, { ms: number; fn: () => void }>();
  private nextId = 0;

  every(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.tasks.set(id, { ms, fn });
    return () => void this.tasks.delete(id);
  }

  now(): number {
    return Date.parse('2026-08-21T12:00:00Z');
  }

  /** How many repeating tasks are registered at that interval — zero means nothing is polling. */
  count(ms: number): number {
    return Array.from(this.tasks.values()).filter((task) => task.ms === ms).length;
  }

  fire(ms: number): void {
    for (const task of Array.from(this.tasks.values())) {
      if (task.ms === ms) {
        task.fn();
      }
    }
  }
}
