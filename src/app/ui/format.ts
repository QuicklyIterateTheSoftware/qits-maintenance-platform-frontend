/**
 * The small conversions the pages need, kept out of the templates so they can be asserted directly.
 *
 * **Every timestamp is rendered in UTC**, as in every sibling explorer: the service stamps
 * `Instant`s, and a browser-local rendering would make two operators looking at the same scan
 * disagree about when it happened. The relative form is the one on screen — "3h ago" is what a
 * reader of a scan list actually asks — and the exact instant sits in its `title`.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `31 Jul 2026 14:02:11Z` — a run's own timestamp, year and seconds included. */
export function formatInstant(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * `4m 12s`, `1h 04m`, `41s`.
 *
 * **A step's duration is computed here and never polled.** Both instants are on the step already,
 * so re-reading a run to learn what a subtraction knows would turn every card into traffic. `to` is
 * null for a step still running, in which case the caller passes the current time and the number
 * ticks locally.
 */
export function formatDuration(from: string | null, to: string | null, nowMs?: number): string {
  const start = parse(from);
  if (!start) {
    return NONE;
  }
  const end = parse(to)?.getTime() ?? nowMs;
  if (end === undefined) {
    return NONE;
  }
  return formatElapsed(end - start.getTime());
}

/** The same rendering, for a span the client measured itself rather than read off two fields. */
export function formatElapsed(millis: number): string {
  const total = Math.max(0, Math.round(millis / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${pad(seconds)}s`;
  }
  return `${seconds}s`;
}

/** `10 runs`, `1 run` — a count is never drawn without the noun it counts. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * `3h ago`, `2m ago`, `just now` — how long ago something happened, against a clock the caller
 * passes in.
 *
 * The overview's question is "is this inventory fresh", and a UTC timestamp answers it only after
 * the reader has done a subtraction in their head. The exact instant is never lost: every place
 * this is drawn carries `formatInstant` in the element's `title`.
 *
 * The clock is an argument rather than `Date.now()` so a spec asserts an exact phrase, and so a
 * page that already ticks a signal redraws these without a second timer.
 */
export function formatRelative(iso: string | null, nowMs: number): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  const seconds = Math.round((nowMs - date.getTime()) / 1000);
  if (seconds < 0) {
    return 'just now';
  }
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}
