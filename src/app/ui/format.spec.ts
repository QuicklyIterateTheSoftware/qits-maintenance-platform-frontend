import { NONE, formatDuration, formatElapsed, formatInstant, formatRelative, plural } from './format';

/**
 * The conversions, including the ones that only ever matter when the data is imperfect: a
 * repository that has never been scanned, a bump that never finished, a clock a little behind the
 * server's.
 */
describe('format', () => {
  const now = Date.parse('2026-08-21T12:00:00Z');

  it('renders an instant in UTC, so two operators read the same clock', () => {
    expect(formatInstant('2026-08-21T09:12:04Z')).toBe('21 Aug 2026 09:12:04Z');
    expect(formatInstant(null)).toBe(NONE);
    expect(formatInstant('not a date')).toBe(NONE);
  });

  it('says how long ago a scan was, which is the question the overview asks', () => {
    expect(formatRelative('2026-08-21T11:58:00Z', now)).toBe('2m ago');
    expect(formatRelative('2026-08-21T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelative('2026-08-18T12:00:00Z', now)).toBe('3d ago');
  });

  /** A repository with no scan at all is not "a long time ago" — it is nothing. */
  it('says nothing for a repository that has never been scanned', () => {
    expect(formatRelative(null, now)).toBe(NONE);
  });

  /** Clocks disagree by seconds; a scan stamped in the near future must not read as "-1m ago". */
  it('reads a stamp ahead of this browser’s clock as just now', () => {
    expect(formatRelative('2026-08-21T12:00:05Z', now)).toBe('just now');
    expect(formatRelative('2026-08-21T11:59:40Z', now)).toBe('just now');
  });

  it('measures a finished bump from its own two instants', () => {
    expect(formatDuration('2026-08-21T09:12:00Z', '2026-08-21T09:16:12Z')).toBe('4m 12s');
    expect(formatDuration('2026-08-21T09:00:00Z', '2026-08-21T10:04:00Z')).toBe('1h 04m');
  });

  /** A running bump has no end, so the caller's clock is the end — which is why it ticks. */
  it('measures a running bump against the clock it was given', () => {
    expect(formatDuration('2026-08-21T09:12:00Z', null, Date.parse('2026-08-21T09:12:41Z'))).toBe(
      '41s',
    );
  });

  it('says nothing rather than zero for a bump that never started', () => {
    expect(formatDuration(null, null, 0)).toBe(NONE);
    expect(formatDuration('2026-08-21T09:12:00Z', null)).toBe(NONE);
  });

  it('never renders a negative span', () => {
    expect(formatElapsed(-5000)).toBe('0s');
  });

  it('counts with the noun it counts', () => {
    expect(plural(1, 'repository', 'repositories')).toBe('1 repository');
    expect(plural(3, 'bump')).toBe('3 bumps');
  });
});
