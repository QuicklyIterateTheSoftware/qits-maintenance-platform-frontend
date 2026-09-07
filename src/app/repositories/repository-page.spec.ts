import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type {
  BumpDto,
  DependentDto,
  DownstreamDto,
  PinDto,
  RepositoryDependentsDto,
  RepositoryDetailDto,
} from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';
import { POLL_INTERVAL_MS } from './repository-page';

/**
 * One repository's page: the pins, what its releases contain, what consumes them, the group panels
 * and the button that writes a branch.
 *
 * The assertions that matter are the ones about the button: it sends the POST the contract names,
 * it is **disabled while that group's bump is running** — and it still reports a 409, because a
 * bump the schedule started a second before the click is a state this page cannot have seen. Beside
 * those, the split of the pins by kind, and the rule that a transitive is never drawn as work.
 */
describe('RepositoryPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const DETAIL_URL = '/maintenance/api/repositories/qits-ci';
  const DEPENDENTS_URL = '/maintenance/api/repositories/qits-ci/dependents';
  const DOWNSTREAM_URL = '/maintenance/api/repositories/qits-ci/downstream';
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
    latestError: null,
    pending: true,
    group: 'dependencies',
    location: 'property:qits.eventstream.version',
    scope: 'DIRECT',
    ...over,
  });

  const detail = (over: Partial<RepositoryDetailDto> = {}): RepositoryDetailDto => ({
    name: 'qits-ci',
    project: 'qits',
    lastScanAt: '2026-08-21T09:00:00Z',
    headSha: 'abc1234',
    status: 'OK',
    message: null,
    pending: 1,
    groups: [
      {
        name: 'dependencies',
        source: 'DEFAULT',
        kind: 'INTERNAL',
        branch: 'maintenance/dependencies',
        state: 'PUSHED',
        headSha: null,
        pending: 1,
      },
    ],
    pins: [pin()],
    transitives: [],
    ...over,
  });

  const dependent = (over: Partial<DependentDto> = {}): DependentDto => ({
    artifactEcosystem: 'maven',
    artifactName: 'eu.wohlben.qits:qits-events',
    artifactVersion: '2026.821.9',
    repository: 'qits-events-service',
    embeddedVersion: '2026.811.1',
    direct: true,
    occurredAt: '2026-08-21T08:00:00Z',
    sbomStatus: 'INGESTED',
    ...over,
  });

  const dependents = (rows: readonly DependentDto[] = []): RepositoryDependentsDto => ({
    repository: 'qits-ci',
    artifacts: [
      {
        ecosystem: 'maven',
        name: 'eu.wohlben.qits:qits-ci-client',
        latest: '2026.901.1',
        dependents: [...rows],
      },
    ],
  });

  const downstream = (over: Partial<DownstreamDto> = {}): DownstreamDto => ({
    repository: 'qits-ci',
    catalogId: 'repo-ci',
    downstream: [],
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
    releaseRequestId: null,
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

  function dependentsRequest() {
    return http.expectOne(
      (candidate) => candidate.url === DEPENDENTS_URL && candidate.method === 'GET',
    );
  }

  function downstreamRequest() {
    return http.expectOne(
      (candidate) => candidate.url === DOWNSTREAM_URL && candidate.method === 'GET',
    );
  }

  async function open(
    repository: RepositoryDetailDto,
    bumps: readonly BumpDto[],
    consumers: RepositoryDependentsDto = dependents(),
    reach: DownstreamDto = downstream(),
  ): Promise<void> {
    harness = await RouterTestingHarness.create('/repositories/qits-ci');
    await settle();
    detailRequest().flush(repository);
    bumpsRequest().flush(bumps);
    dependentsRequest().flush(consumers);
    downstreamRequest().flush(reach);
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

  /** A failed lookup leaves a blank latest and a false pending, which must not read as good news. */
  it('says so beside the latest when the registry could not be asked', async () => {
    await open(
      detail({
        pins: [pin({ latest: null, latestError: 'mirror answered 502', pending: false })],
      }),
      [],
    );

    const cell = page().querySelector('.lookup-error');
    expect(cell?.textContent).toContain('lookup failed');
    expect(cell?.getAttribute('title')).toContain('502');
    http.verify();
  });

  /** Two tables, because internal pins are release work and external pins are patching. */
  it('splits the pins by kind, and folds away the ones nothing can move', async () => {
    await open(
      detail({
        pins: [
          pin(),
          pin({ name: 'io.quarkus:quarkus-bom', kind: 'EXTERNAL', pending: false }),
          pin({ name: 'eu.wohlben.qits:qits-parent', kind: 'REACTOR', pending: false }),
        ],
      }),
      [],
    );

    const tables = page().querySelectorAll('app-pins-table');
    expect(tables[0].querySelector('h2')?.textContent).toContain('Internal pins');
    expect(tables[0].textContent).toContain('qits-eventstream');
    expect(tables[0].textContent).not.toContain('quarkus-bom');
    expect(tables[1].querySelector('h2')?.textContent).toContain('External pins');
    expect(tables[1].textContent).toContain('quarkus-bom');
    expect(page().querySelector('details summary')?.textContent).toContain('Own / unresolved');
    expect(page().querySelector('details')?.textContent).toContain('qits-parent');
    http.verify();
  });

  /**
   * A transitive is not a pin: there is no line to edit and no bump to press, so it is never drawn
   * in the amber that means work is waiting — and it is not drawn at all until it is asked for.
   */
  it('folds what a release contains under the pin that pulled it in, greyed and collapsed', async () => {
    await open(
      detail({
        transitives: [
          {
            ecosystem: 'maven',
            name: 'com.fasterxml.jackson.core:jackson-databind',
            version: '2.17.0',
            via: 'eu.wohlben.qits:qits-eventstream',
            behind: true,
          },
        ],
      }),
      [],
    );

    expect(page().textContent).not.toContain('jackson-databind');

    page().querySelector<HTMLButtonElement>('app-pins-table .chevron')?.click();
    await settle();

    const transitive = page().querySelector('.row-transitive');
    expect(transitive?.textContent).toContain('jackson-databind');
    expect(transitive?.textContent).toContain('newer available');
    expect(transitive?.className).not.toContain('row-pending');
    http.verify();
  });

  /** A component no pin on the page accounts for is the one an advisory is most likely to name. */
  it('keeps a transitive whose via is nobody’s pin, under the root disclosure', async () => {
    await open(
      detail({
        transitives: [
          { ecosystem: 'npm', name: 'tslib', version: '2.6.0', via: null, behind: false },
        ],
      }),
      [],
    );

    const roots = page().querySelector('.row-roots');
    expect(roots?.textContent).toContain('(root)');

    roots?.querySelector<HTMLButtonElement>('.chevron')?.click();
    await settle();

    expect(page().querySelector('.row-transitive')?.textContent).toContain('tslib');
    http.verify();
  });

  /** The other direction: what the platform has already released that carries this repository. */
  it('lists what consumes the repository’s artifacts, and links each one', async () => {
    await open(detail(), [], dependents([dependent()]));

    const table = page().querySelector('app-dependents-table');
    expect(table?.querySelector('a')?.getAttribute('href')).toBe(
      '/repositories/qits-events-service',
    );
    expect(table?.textContent).toContain('2026.811.1');
    expect(table?.textContent).toContain('direct');
    // Each artifact's group carries ITS latest, so the verdict is real: the fixture embeds
    // 2026.811.1 against a latest of 2026.901.1, and the row says so.
    expect(table?.textContent).toContain('BEHIND');
    expect(page().textContent).toContain('latest 2026.901.1');
    http.verify();
  });

  it('says nothing consumes a repository rather than drawing blank space', async () => {
    await open(detail(), [], { repository: 'qits-ci', artifacts: [] });

    expect(page().querySelector('app-dependents-table')).toBeNull();
    expect(page().textContent).toContain('Nothing on the platform consumes');
    http.verify();
  });

  /**
   * The other direction followed to the end: not who consumes this repository, but who consumes
   * them as well — which is what a release of it is going to reach.
   */
  it('lists what is downstream with its distance and the chain that reached it', async () => {
    await open(
      detail(),
      [],
      dependents(),
      downstream({
        downstream: [
          {
            repository: 'qits-ci-frontend',
            catalogId: 'r1',
            archetype: 'FRONTEND',
            depth: 1,
            via: [],
          },
          {
            repository: 'qits-ci-service',
            catalogId: 'r2',
            archetype: 'SERVICE',
            depth: 2,
            via: ['qits-ci-frontend'],
          },
        ],
      }),
    );

    const table = page().querySelector('app-downstream-table');
    const rows = table?.querySelectorAll('tbody tr') ?? [];
    expect(rows[0].textContent).toContain('qits-ci-frontend');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/repositories/qits-ci-frontend');
    expect(rows[1].textContent).toContain('qits-ci-service');
    // The hop that a one-level answer would have missed, and what it was reached through.
    expect(rows[1].textContent).toContain('2');
    expect(rows[1].textContent).toContain('qits-ci-frontend');
    expect(table?.querySelector('caption')?.textContent).toContain('2 repositories downstream');
    http.verify();
  });

  it('says nothing is downstream of a repository rather than drawing an empty table', async () => {
    await open(detail(), []);

    expect(page().querySelector('app-downstream-table')).toBeNull();
    expect(page().textContent).toContain('Nothing on the platform is downstream');
    http.verify();
  });

  /** A release is a fact that happened: a bump cannot move it, so the poll never re-reads it. */
  it('never re-reads the dependents or the closure while it polls a running bump', async () => {
    await open(detail(), [bump({ status: 'RUNNING', finishedAt: null })]);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    detailRequest().flush(detail());
    bumpsRequest().flush([bump({ status: 'SUCCEEDED' })]);
    await settle();

    // No dependents and no downstream request to flush: http.verify() is the assertion.
    http.verify();
  });

  /** The ask's answer rides along with the bump, and a sentinel is never drawn as an id to click. */
  it('names the release request beside a bump’s message', async () => {
    await open(detail(), [bump({ releaseRequestId: 'converged' })]);

    const release = page().querySelector('.release');
    expect(release?.textContent).toContain('converged');
    expect(release?.getAttribute('title')).toContain('nothing left to ask for');
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
    dependentsRequest().flush(dependents());
    downstreamRequest().flush(downstream());
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
