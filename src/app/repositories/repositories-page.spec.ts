import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { BumpDto, RepositoryDto } from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';
import { POLL_INTERVAL_MS, SCAN_POLL_LIMIT } from './repositories-page';

/**
 * The overview, one behaviour at a time.
 *
 * Driven through the router rather than by constructing the component, which is the house pattern:
 * the page is a lazy route and its own address is part of what it is.
 *
 * The two behaviours worth the most here are the ones nobody sees until they are wrong: **the page
 * stops polling** when nothing is in flight, and **a scan that changes no row is given up on**
 * rather than followed for ever.
 */
describe('RepositoriesPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const REPOS_URL = '/maintenance/api/repositories';
  const BUMPS_URL = '/maintenance/api/bumps';

  const repository = (over: Partial<RepositoryDto> = {}): RepositoryDto => ({
    name: 'qits-ci',
    lastScanAt: '2026-08-21T09:00:00Z',
    status: 'OK',
    message: null,
    pending: 2,
    groups: [{ name: 'dependencies', branch: 'maintenance/dependencies', state: 'NONE', pending: 2 }],
    ...over,
  });

  const bump = (over: Partial<BumpDto> = {}): BumpDto => ({
    id: 'bump-1',
    repository: 'qits-ci',
    group: 'dependencies',
    environment: 'dev',
    trigger: 'MANUAL',
    ciEventId: 'bump-1',
    ciRunId: 'run-7',
    status: 'SUCCEEDED',
    changes: [],
    startedAt: '2026-08-21T09:30:00Z',
    finishedAt: '2026-08-21T09:31:00Z',
    message: '1 dependency',
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

  async function settle(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function reposRequest() {
    return http.expectOne((candidate) => candidate.url === REPOS_URL && candidate.method === 'GET');
  }

  function bumpsRequest() {
    return http.expectOne((candidate) => candidate.url === BUMPS_URL && candidate.method === 'GET');
  }

  /** Open the page with the two reads it makes on arrival already answered. */
  async function open(
    repositories: readonly RepositoryDto[],
    bumps: readonly BumpDto[],
  ): Promise<void> {
    harness = await RouterTestingHarness.create('/');
    await settle();
    reposRequest().flush(repositories);
    bumpsRequest().flush(bumps);
    await settle();
  }

  it('lists a repository with when it was scanned, what is behind, and its groups', async () => {
    await open([repository()], []);

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('qits-ci');
    expect(row?.textContent).toContain('OK');
    expect(row?.textContent).toContain('maintenance/dependencies');
    expect(row?.textContent).toContain('2 pending');
    http.verify();
  });

  /** A message is a sentence, so it rides in a title rather than widening every row. */
  it('keeps a failed scan’s message on the badge for the reader to hover', async () => {
    await open(
      [repository({ status: 'CONFIG_ERROR', message: 'maintenance.yml: bad indentation, line 4' })],
      [],
    );

    const badge = page().querySelector('tbody tr td:nth-child(3) span');
    expect(badge?.getAttribute('title')).toContain('bad indentation');
    http.verify();
  });

  it('says the catalog has never been scanned rather than drawing blank space', async () => {
    await open([], []);

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('No repository has been scanned yet');
    http.verify();
  });

  it('starts an internal scan and re-reads both lists', async () => {
    await open([repository()], []);

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();

    const post = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/scans' && candidate.method === 'POST',
    );
    expect(post.request.body).toEqual({ scope: 'INTERNAL' });
    post.flush({ id: 'scan-1' }, { status: 202, statusText: 'Accepted' });
    await settle();

    reposRequest().flush([repository()]);
    bumpsRequest().flush([]);
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('scan accepted');
    http.verify();
  });

  it('sends EXTERNAL from the second button and on no other', async () => {
    await open([repository()], []);

    page().querySelectorAll<HTMLButtonElement>('.actions button')[1].click();
    await settle();

    const post = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/scans' && candidate.method === 'POST',
    );
    expect(post.request.body).toEqual({ scope: 'EXTERNAL' });
    post.flush({ id: 'scan-2' }, { status: 202, statusText: 'Accepted' });
    await settle();
    reposRequest().flush([repository()]);
    bumpsRequest().flush([]);
    await settle();
    http.verify();
  });

  it('reports a scan the service refused, in the service’s own words', async () => {
    await open([repository()], []);

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();
    http
      .expectOne((candidate) => candidate.url === '/maintenance/api/scans')
      .flush({ message: 'githost is down' }, { status: 503, statusText: 'Down' });
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('503 githost is down');
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  /**
   * A scan has no address of its own, so "it finished" is read off the rows it moves — against the
   * server's own timestamps, never against this browser's clock.
   */
  it('follows a scan until every row has moved, then stops', async () => {
    await open([repository()], []);

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();
    http
      .expectOne('/maintenance/api/scans')
      .flush({ id: 'scan-1' }, { status: 202, statusText: 'Accepted' });
    await settle();
    reposRequest().flush([repository()]);
    bumpsRequest().flush([]);
    await settle();

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    reposRequest().flush([repository({ lastScanAt: '2026-08-21T10:00:00Z' })]);
    bumpsRequest().flush([]);
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('Scan finished');
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  /** No spinner for ever: a scan that moves no row is given up on, and says so. */
  it('stops waiting for a scan that never moves a row', async () => {
    await open([repository()], []);

    page().querySelectorAll<HTMLButtonElement>('.actions button')[1].click();
    await settle();
    http
      .expectOne('/maintenance/api/scans')
      .flush({ id: 'scan-2' }, { status: 202, statusText: 'Accepted' });
    await settle();
    reposRequest().flush([repository()]);
    bumpsRequest().flush([]);
    await settle();

    for (let poll = 0; poll < SCAN_POLL_LIMIT; poll += 1) {
      scheduler.fire(POLL_INTERVAL_MS);
      await settle(2);
      reposRequest().flush([repository()]);
      bumpsRequest().flush([]);
      await settle(2);
    }

    expect(page().querySelector('.page-note')?.textContent).toContain('taking longer');
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('polls while a bump is running and stops when it stops', async () => {
    await open([repository()], [bump({ status: 'RUNNING', finishedAt: null })]);

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    reposRequest().flush([repository()]);
    bumpsRequest().flush([bump({ status: 'SUCCEEDED' })]);
    await settle();

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('never polls a listing that was already settled when it was read', async () => {
    await open([repository()], [bump()]);

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('keeps the last good listing on screen when a poll fails, and says so', async () => {
    await open([repository()], [bump({ status: 'RUNNING', finishedAt: null })]);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    reposRequest().flush(null, { status: 0, statusText: 'Unknown Error' });
    bumpsRequest().flush([]);
    await settle();

    expect(page().querySelector('.stale')?.textContent).toContain('unreachable');
    expect(page().querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);
    http.verify();
  });

  it('reports a failed listing and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/');
    await settle();
    reposRequest().flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    bumpsRequest().flush([]);
    await settle();

    expect(page().textContent).toContain('503 nope');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    reposRequest().flush([repository()]);
    await settle();

    expect(page().querySelector('tbody tr')?.textContent).toContain('qits-ci');
    http.verify();
  });
});
