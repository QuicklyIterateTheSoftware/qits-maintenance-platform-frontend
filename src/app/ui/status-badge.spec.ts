import { TestBed } from '@angular/core/testing';
import { toneOf } from './status-tone';
import { StatusBadge } from './status-badge';

/**
 * The map is the component, so the map is what is asserted — including the fallback, because a new
 * status on the service side must render as a plain badge rather than break a table.
 */
describe('status tone', () => {
  it('reads a scan that worked and one that found nothing as different things', () => {
    expect(toneOf('OK')).toBe('success');
    expect(toneOf('ABSENT')).toBe('neutral');
  });

  it('reads a repository the scan could not read as a failure', () => {
    expect(toneOf('UNREACHABLE')).toBe('danger');
    expect(toneOf('CONFIG_ERROR')).toBe('danger');
  });

  /** A branch someone rewrote by hand is not broken — the service just stops pushing to it. */
  it('reads a hand-rewritten branch as a warning rather than a failure', () => {
    expect(toneOf('STALE')).toBe('warning');
    expect(toneOf('FAILED')).toBe('danger');
  });

  it('reads a queued bump and a running one as the same colour', () => {
    expect(toneOf('REQUESTED')).toBe('warning');
    expect(toneOf('RUNNING')).toBe('warning');
  });

  it('reads a bump that had nothing to do as a non-event', () => {
    expect(toneOf('NOTHING_TO_DO')).toBe('neutral');
    expect(toneOf('SUCCEEDED')).toBe('success');
  });

  /**
   * A train still travelling is the ordinary state of a release an hour old, and a later release
   * retiring one is housekeeping. Neither is a warning, and colouring them so would put amber on
   * most of the listing on most days.
   */
  it('reads a travelling train as information and a retired one as a non-event', () => {
    expect(toneOf('OPEN')).toBe('info');
    expect(toneOf('COMPLETED')).toBe('success');
    expect(toneOf('SUPERSEDED')).toBe('neutral');
  });

  /** The three stages of one consumer, and the amber PENDING already had from the SBOM column. */
  it('separates a consumer that has not moved from one that adopted and one that landed', () => {
    expect(toneOf('PENDING')).toBe('warning');
    expect(toneOf('ADOPTED')).toBe('info');
    expect(toneOf('LANDED')).toBe('success');
  });

  it('falls back to neutral for a status this build has never heard of', () => {
    expect(toneOf('SOMETHING_NEW')).toBe('neutral');
  });
});

describe('StatusBadge', () => {
  async function badgeOf(status: string): Promise<HTMLElement | null> {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('qits-badge');
  }

  it('renders the status word itself — a coloured dot is not a status', async () => {
    expect((await badgeOf('CONFIG_ERROR'))?.textContent).toContain('CONFIG_ERROR');
  });

  it('passes the tone through to the platform badge', async () => {
    expect((await badgeOf('FAILED'))?.firstElementChild?.className).toContain('danger');
  });
});
