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
   * The two states of a downstream repository, and the amber PENDING already had from the SBOM
   * column. A repository that has not taken a release yet is waiting rather than failing, and one
   * that has is information rather than an outcome — colouring either differently would put a
   * verdict on the ordinary course of a release travelling downstream.
   */
  it('separates a repository that has taken a release from one that has not', () => {
    expect(toneOf('PENDING')).toBe('warning');
    expect(toneOf('ADOPTED')).toBe('info');
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
