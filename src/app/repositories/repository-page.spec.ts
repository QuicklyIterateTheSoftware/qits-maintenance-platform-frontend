import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { BumpDto, PinDto, RepositoryDetailDto } from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';
import { POLL_INTERVAL_MS } from './repository-page';

/**
 * One repository's page: the pins, the group panels and the button that writes a branch.
 *
 * The assertions that matter are the ones about the button: it sends the POST the contract names,
 * it is **disabled while that group's bump is running** — and it still reports a 409, because a
 * bump the schedule started a second before the click is a state this page cannot have seen.
 */
describe('RepositoryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const DETAIL_URL = '/maintenance/api/repositories/qits-ci';
  const BUMPS_URL = '/maintenance/api/bumps';
  const BUMP_URL = '/maintenance/api/repositories/qits-ci/groups/dependencies/bumps';

  const pin = (over: Partial<PinDto> = {}): PinDto => ({
    manifestPath: 'pom.xml',
    ecosystem: 'maven',
    name: 'eu.wohlben.qits:qits-eventstream',
    version: '2026.811.1',
    range: null,
    kind: 'INTERNAL',
    latest: '2026.821.3',
    pending: true,
    group: 'dependencies',
    location: 'property:qits.eventstream.version',
    ...over,
  });

  const detail = (over: Partial<RepositoryDetailDto> = {}): RepositoryDetailDto => ({
    name: 'qits-ci',
    lastScanAt: '2026-08-21T09:00:00Z',
    status: 'OK',
    message: null,
    pending: 1,
    groups: [
      { name: 'dependencies', branch: 'maintenance/dependencies', state: 'PUSHED', pending: 1 },
    ],
    pins: [pin()],
    ...over,
  });

  const bump = (over: Partial<BumpDto> = {}): BumpDto => ({
    id: 'bump-1',
    repository: 'qits-ci',
    group: 'dependencies',
    environment: 'dev',
    trigger: 'SCHEDULED',
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

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function detailRequest() {
    return http.expectOne((candidate) => candidate.url === DETAIL_URL && candidate.method === 'GET');
  }

  function bumpsRequest() {
    return http.expectOne((candidate) => candidate.url === BUMPS_URL && candidate.method === 'GET');
  }

  async function open(
    repository: RepositoryDetailDto,
    bumps: readonly BumpDto[],
  ): Promise<void> {
    harness = await RouterTestingHarness.create('/repositories/qits-ci');
    await settle();
    detailRequest().flush(repository);
    bumpsRequest().flush(bumps);
    await settle();
  }

  it('asks for the repository the URL names, and says which one it is', async () => {
    await open(detail(), []);

    expect(page().querySelector('h1')?.textContent).toContain('qits-ci');
    expect(page().querySelector('.crumbs')?.textContent).toContain('Repositories');
    http.verify();
  });

  it('draws a pin with both versions and where the pin is written', async () => {
    await open(detail(), []);

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('eu.wohlben.qits:qits-eventstream');
    expect(row?.textContent).toContain('2026.811.1');
    expect(row?.textContent).toContain('2026.821.3');
    expect(row?.textContent).toContain('property:qits.eventstream.version');
    http.verify();
  });

  /** Behind is the service's word: a client comparing two version strings would mark the wrong rows. */
  it('highlights the pins the service called pending, and only those', async () => {
    await open(
      detail({
        pins: [pin(), pin({ name: '@qits/angular', pending: false, ecosystem: 'npm' })],
      }),
      [],
    );

    const rows = page().querySelectorAll('tbody tr');
    expect(rows[0].className).toContain('row-pending');
    expect(rows[1].className).not.toContain('row-pending');
    http.verify();
  });

  it('asks for the branch at the group’s own address', async () => {
    await open(detail(), []);

    page().querySelector<HTMLButtonElement>('qits-card button')?.click();
    await settle();

    const post = http.expectOne(
      (candidate) => candidate.url === BUMP_URL && candidate.method === 'POST',
    );
    post.flush({ id: 'bump-9' }, { status: 202, statusText: 'Accepted' });
    await settle();
    bumpsRequest().flush([bump({ id: 'bump-9', status: 'REQUESTED', finishedAt: null })]);
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('bump-9 accepted');
    http.verify();
  });

  it('says a bump is already running when the service answers 409', async () => {
    await open(detail(), []);

    page().querySelector<HTMLButtonElement>('qits-card button')?.click();
    await settle();
    http
      .expectOne((candidate) => candidate.url === BUMP_URL && candidate.method === 'POST')
      .flush({ message: 'active' }, { status: 409, statusText: 'Conflict' });
    await settle();
    bumpsRequest().flush([bump({ status: 'RUNNING', finishedAt: null })]);
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('a bump is already running');
    http.verify();
  });

  it('reports a bump refused for any other reason, in the service’s own words', async () => {
    await open(detail(), []);

    page().querySelector<HTMLButtonElement>('qits-card button')?.click();
    await settle();
    http
      .expectOne((candidate) => candidate.url === BUMP_URL && candidate.method === 'POST')
      .flush({ message: 'ci is unreachable' }, { status: 503, statusText: 'Down' });
    await settle();
    bumpsRequest().flush([]);
    await settle();

    expect(page().querySelector('.page-note')?.textContent).toContain('503 ci is unreachable');
    http.verify();
  });

  it('disables a group’s button while that group’s branch is being written', async () => {
    await open(detail(), [bump({ status: 'RUNNING', finishedAt: null })]);

    expect(page().querySelector<HTMLButtonElement>('qits-card button')?.disabled).toBe(true);
    expect(page().querySelector('.panel-facts a')?.textContent).toContain('a bump is running');
    http.verify();
  });

  it('polls while a bump is running and stops when it stops', async () => {
    await open(detail(), [bump({ status: 'RUNNING', finishedAt: null })]);

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    detailRequest().flush(detail());
    bumpsRequest().flush([bump({ status: 'SUCCEEDED' })]);
    await settle();

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('never polls a repository whose bumps have all finished', async () => {
    await open(detail(), [bump()]);

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  it('says a repository could not be read, and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/repositories/qits-ci');
    await settle();
    detailRequest().flush({ message: 'no such repository' }, { status: 404, statusText: 'Not Found' });
    bumpsRequest().flush([]);
    await settle();

    expect(page().textContent).toContain('404 no such repository');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    detailRequest().flush(detail());
    await settle();

    expect(page().querySelector('tbody tr')?.textContent).toContain('qits-eventstream');
    http.verify();
  });

  it('shows a repository with no pins as read-but-empty, not as blank space', async () => {
    await open(detail({ pins: [], pending: 0 }), []);

    expect(page().querySelectorAll('app-empty').length).toBeGreaterThan(0);
    http.verify();
  });
});
