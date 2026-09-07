import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationLinks,
  provideQitsProjectList,
  provideQitsScope,
} from '@qits/ui-components';
import type { AdopterDto, AdoptionJourneyDto } from '../api/dto';
import { routes } from '../app.routes';
import { ManualScheduler } from '../testing/manual-scheduler';
import { QITS_SCHEDULER } from '../ui/scheduler';

/**
 * The adoption journey of one release.
 *
 * The assertions that earn their place are the ones the page exists for and nobody sees until they
 * are wrong: **one request answers the whole journey** — there is no stitching left to do, which is
 * the entire difference from the release trains this replaced; **the rows are grouped by distance**
 * in the service's own order, so a repository two hops down is drawn under a header that says so;
 * and **what a row says depends on its state** — an adopted one names the release of its own that
 * carried the version, a pending one names what it is waiting behind, because that is where the
 * wait actually is.
 */
describe('AdoptionPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const ADOPTION_URL = '/maintenance/api/adoption/by-release';

  /** The projects the chrome knows, so `/qits/…` parses as a project and `/adoption/…` does not. */
  const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

  const adopter = (over: Partial<AdopterDto> = {}): AdopterDto => ({
    repository: 'qits-ci-frontend',
    catalogId: 'r1',
    repositoryStatus: 'OK',
    archetype: 'FRONTEND',
    depth: 1,
    via: [],
    state: 'ADOPTED',
    adoptedVersion: '2026.905.7',
    adoptedAt: '2026-08-21T09:10:00Z',
    ...over,
  });

  const journey = (over: Partial<AdoptionJourneyDto> = {}): AdoptionJourneyDto => ({
    repository: 'qits-eventstream',
    catalogId: 'repo-eventstream',
    version: '2026.905.1',
    packages: [{ ecosystem: 'maven', name: 'eu.wohlben.qits:qits-eventstream' }],
    adopters: [adopter()],
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks([]),
        provideQitsProjectList(PROJECTS),
        provideQitsScope('project'),
        { provide: QITS_SCHEDULER, useValue: new ManualScheduler() },
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

  function adoptionRequest() {
    return http.expectOne(
      (candidate) => candidate.url === ADOPTION_URL && candidate.method === 'GET',
    );
  }

  function rowText(): readonly string[] {
    return Array.from(page().querySelectorAll('tbody tr')).map(
      (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  async function open(
    answer: AdoptionJourneyDto,
    address = '/adoption/qits-eventstream/2026.905.1',
  ): Promise<void> {
    harness = await RouterTestingHarness.create(address);
    await settle();
    adoptionRequest().flush(answer);
    await settle();
  }

  /** One call, and both halves of the release travel in it as query parameters. */
  it('asks for the release the address names, and says which one it is', async () => {
    harness = await RouterTestingHarness.create('/adoption/qits-eventstream/2026.905.1');
    await settle();

    const request = adoptionRequest();
    expect(request.request.params.get('repository')).toBe('qits-eventstream');
    expect(request.request.params.get('version')).toBe('2026.905.1');
    request.flush(journey());
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('qits-eventstream');
    expect(page().querySelector('h1')?.textContent).toContain('2026.905.1');
    expect(page().querySelector('.facts')?.textContent).toContain(
      'maven eu.wohlben.qits:qits-eventstream',
    );
    // The whole journey arrived in that one answer: there is nothing left to follow.
    http.verify();
  });

  /**
   * A header per distance, and the rows at it underneath — which is what makes a deep row readable:
   * a repository two hops away is waiting on the one above it, not on this release.
   */
  it('groups the rows by how far downstream they are, in the service’s order', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          adopter({
            repository: 'qits-ci-service',
            catalogId: 'r2',
            archetype: 'SERVICE',
            depth: 2,
            via: ['qits-ci-frontend'],
            state: 'PENDING',
            adoptedVersion: null,
            adoptedAt: null,
          }),
        ],
      }),
    );

    const rows = rowText();
    expect(rows[0]).toContain('Directly downstream');
    expect(rows[0]).toContain('1/1 carrying it');
    expect(rows[1]).toContain('qits-ci-frontend');
    expect(rows[2]).toContain('2 hops downstream');
    expect(rows[2]).toContain('0/1 carrying it');
    expect(rows[3]).toContain('qits-ci-service');
    expect(page().querySelector('caption')?.textContent).toContain(
      '2 repositories downstream of this release, 1 carrying it',
    );
    http.verify();
  });

  /** The two states, and the two different things a row has to say about itself. */
  it('names the version an adopter carries, and what a pending one waits behind', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          adopter({
            repository: 'qits-ci-service',
            depth: 2,
            via: ['qits-ci-frontend'],
            state: 'PENDING',
            adoptedVersion: null,
            adoptedAt: null,
          }),
        ],
      }),
    );

    const rows = rowText();
    expect(rows[1]).toContain('ADOPTED');
    expect(rows[1]).toContain('2026.905.7');
    expect(rows[3]).toContain('PENDING');
    expect(rows[3]).toContain('waiting behind qits-ci-frontend');
    expect(rows[3]).not.toContain('2026.905.7');
    http.verify();
  });

  /** Nothing above it to wait on: a direct consumer that has simply not released since. */
  it('says a pending row one hop away is waiting on its own next release', async () => {
    await open(
      journey({
        adopters: [adopter({ state: 'PENDING', adoptedVersion: null, adoptedAt: null })],
      }),
    );

    expect(rowText()[1]).toContain('has not released with it yet');
    http.verify();
  });

  /**
   * The link is drawn where the inventory holds a row for the name, and the catalog's word about
   * that row is drawn beside it: a repository that left the catalog will never take this release.
   */
  it('links an adopter this inventory knows, and says when one has left the catalog', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          adopter({ repository: 'qits-retired', repositoryStatus: 'ABSENT', depth: 1 }),
          adopter({ repository: 'qits-unknown', repositoryStatus: null, depth: 1 }),
        ],
      }),
    );

    const links = Array.from(page().querySelectorAll('tbody a')).map((anchor) =>
      anchor.getAttribute('href'),
    );
    expect(links).toContain('/repositories/qits-ci-frontend');
    expect(links).not.toContain('/repositories/qits-unknown');
    expect(page().querySelector('.absent')?.textContent).toContain('absent');
    http.verify();
  });

  /** In-app links keep the project the address names, as everywhere else in this application. */
  it('keeps the scoped project in the links it draws', async () => {
    await open(journey(), '/qits/adoption/qits-eventstream/2026.905.1');

    expect(page().querySelector('tbody a')?.getAttribute('href')).toBe(
      '/qits/repositories/qits-ci-frontend',
    );
    http.verify();
  });

  it('says a release reached nothing rather than drawing an empty table', async () => {
    await open(journey({ adopters: [] }));

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('downstream of this release');
    http.verify();
  });

  /**
   * A release this service holds no packages for. The closure below it is still true, so this is a
   * sentence above the table rather than an error instead of it — a page of pending rows with no
   * explanation would read as a platform that had stopped.
   */
  it('says so when it knows of nothing the release published', async () => {
    await open(
      journey({
        packages: [],
        adopters: [adopter({ state: 'PENDING', adoptedVersion: null, adoptedAt: null })],
      }),
    );

    expect(page().querySelector('.note')?.textContent).toContain('knows of nothing published');
    expect(page().querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    http.verify();
  });

  /**
   * Nothing polls here — a pending row moves when a downstream repository releases — so the reader
   * is offered the same question again instead, and pressing it re-issues the one call.
   */
  it('asks the same question again on request', async () => {
    await open(journey());

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();
    adoptionRequest().flush(
      journey({
        adopters: [adopter({ repository: 'qits-ci-frontend', adoptedVersion: '2026.905.9' })],
      }),
    );
    await settle();

    expect(rowText()[1]).toContain('2026.905.9');
    http.verify();
  });

  it('reports a journey that could not be read, and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/adoption/qits-eventstream/2026.905.1');
    await settle();
    adoptionRequest().flush(
      { message: 'the graph is unreadable' },
      { status: 503, statusText: 'Down' },
    );
    await settle();

    expect(page().textContent).toContain('503 the graph is unreadable');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    adoptionRequest().flush(journey());
    await settle();

    expect(rowText()[1]).toContain('qits-ci-frontend');
    http.verify();
  });
});
