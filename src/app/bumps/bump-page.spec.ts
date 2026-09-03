import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { BumpDto } from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';
import { POLL_INTERVAL_MS } from './bump-page';

/**
 * One bump, and the two things about it that are easy to get wrong: **the branch**, which the row
 * may not carry and which then falls back to the group's own, and **the link to the CI run**, which
 * leaves this application and so must be an href rather than a router link.
 */
describe('BumpPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const URL = '/maintenance/api/bumps/bump-1';

  const bump = (over: Partial<BumpDto> = {}): BumpDto => ({
    id: 'bump-1',
    repository: 'qits-ci',
    group: 'dependencies',
    environment: 'dev',
    trigger: 'MANUAL',
    ciEventId: 'bump-1',
    ciRunId: 'run-7',
    status: 'SUCCEEDED',
    changes: [
      {
        ecosystem: 'maven',
        manifestPath: 'pom.xml',
        name: 'eu.wohlben.qits:qits-eventstream',
        from: '2026.811.1',
        to: '2026.821.3',
        location: 'property:qits.eventstream.version',
      },
    ],
    startedAt: '2026-08-21T09:30:00Z',
    finishedAt: '2026-08-21T09:31:00Z',
    message: null,
    releaseRequestId: 'rr-42',
    ...over,
  });

  beforeEach(() => {
    scheduler = new ManualScheduler();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks([]),
        { provide: QITS_SCHEDULER, useValue: scheduler },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function open(row: BumpDto): Promise<void> {
    harness = await RouterTestingHarness.create('/bumps/bump-1');
    await settle();
    http.expectOne(URL).flush(row);
    await settle();
  }

  it('draws the bump’s facts, and the changes it sent', async () => {
    await open(bump());

    const facts = page().querySelector('.facts')?.textContent ?? '';
    expect(facts).toContain('qits-ci');
    expect(facts).toContain('dependencies');
    expect(facts).toContain('MANUAL');
    expect(facts).toContain('21 Aug 2026 09:30:00Z');

    const change = page().querySelector('tbody tr')?.textContent ?? '';
    expect(change).toContain('eu.wohlben.qits:qits-eventstream');
    expect(change).toContain('2026.811.1');
    expect(change).toContain('2026.821.3');
    expect(change).toContain('property:qits.eventstream.version');
    http.verify();
  });

  /** The row need not carry a branch; the group's own is the branch the service writes anyway. */
  it('falls back to the group’s branch when the row does not name one', async () => {
    await open(bump());
    expect(page().querySelector('.facts')?.textContent).toContain('maintenance/dependencies');
    http.verify();
  });

  it('prefers the branch the row does name', async () => {
    await open(bump({ branch: 'maintenance/angular' }));
    expect(page().querySelector('.facts')?.textContent).toContain('maintenance/angular');
    http.verify();
  });

  /** qits-ci is another application at another base path, so this is an href, not a router link. */
  it('links the CI run out of this application', async () => {
    await open(bump());

    const link = page().querySelector<HTMLAnchorElement>('.facts a[href="/ci/runs/run-7"]');
    expect(link?.textContent).toContain('run-7');
    http.verify();
  });

  /** A bump does not end at the branch: what the release ask answered is on the row, id or word. */
  it('names the release request qits-projects answered with', async () => {
    await open(bump());
    expect(page().querySelector('.facts')?.textContent).toContain('rr-42');
    http.verify();
  });

  /**
   * “converged” is not an id and is never linked. It is drawn as it arrives — inventing a
   * friendlier word would be this page disagreeing with the record — with the sentence beside it.
   */
  it('explains a sentinel rather than passing it off as a request id', async () => {
    await open(bump({ releaseRequestId: 'converged' }));

    const facts = page().querySelector('.facts')?.textContent ?? '';
    expect(facts).toContain('converged');
    expect(facts).toContain('nothing left to ask for');
    http.verify();
  });

  it('says a bump with no release request has none', async () => {
    await open(bump({ status: 'NOTHING_TO_DO', releaseRequestId: null, changes: [] }));

    expect(page().querySelector('.facts')?.textContent).not.toContain('converged');
    http.verify();
  });

  it('says a bump with no run yet has none, rather than linking nowhere', async () => {
    await open(bump({ status: 'REQUESTED', ciRunId: null, finishedAt: null }));

    expect(page().querySelector('.facts a[href^="/ci/"]')).toBeNull();
    http.verify();
  });

  it('re-reads a bump that has not finished, and stops when it has', async () => {
    await open(bump({ status: 'RUNNING', finishedAt: null }));

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    http.expectOne(URL).flush(bump({ status: 'SUCCEEDED' }));
    await settle();

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('never polls a bump that was already finished when it was read', async () => {
    await open(bump({ status: 'FAILED', message: 'push rejected: non-fast-forward' }));

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    expect(page().querySelector('.page-error')?.textContent).toContain('non-fast-forward');
    http.verify();
  });

  it('keeps the bump on screen when a poll fails, and says so', async () => {
    await open(bump({ status: 'RUNNING', finishedAt: null }));

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    http.expectOne(URL).flush(null, { status: 0, statusText: 'Unknown Error' });
    await settle();

    expect(page().querySelector('.stale')?.textContent).toContain('unreachable');
    expect(page().querySelector('tbody tr')).not.toBeNull();
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);
    http.verify();
  });

  it('says a bump that changed nothing changed nothing', async () => {
    await open(bump({ status: 'NOTHING_TO_DO', changes: [] }));

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('NOTHING_TO_DO');
    http.verify();
  });

  it('reports a bump that could not be read, and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/bumps/bump-1');
    await settle();
    http.expectOne(URL).flush({ message: 'no such bump' }, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(page().textContent).toContain('404 no such bump');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    http.expectOne(URL).flush(bump());
    await settle();

    expect(page().querySelector('.facts')?.textContent).toContain('qits-ci');
    http.verify();
  });
});
