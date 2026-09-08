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
 * The adoption journey of one release, drawn as a flowchart.
 *
 * The assertions that earn their place are the ones the page exists for and nobody sees until they
 * are wrong. **One request answers the whole journey** — there is no stitching left to do, which is
 * the entire difference from the release trains this replaced. **A repository is one card, however
 * many paths reach it**, with an edge in from each of them: `via` names all the parents one hop
 * nearer the release, and the page that read it as a chain — "waiting behind a → b" — was inventing
 * an order between two siblings. **A card's column is its distance**, so a repository two hops down
 * is drawn two columns out rather than under a sentence saying so. And **the rows in a column are
 * ordered by the answer and not by the order it arrived in**, which is the one thing a flowchart
 * needs that a table did not: a card sits level with the parents that feed it, so the edges stay
 * short and stop crossing each other for no reason a reader could see.
 *
 * Everything is asserted structurally — data attributes, classes, counts — and never in pixels.
 * The geometry is arithmetic the component owns; what a spec has to defend is which card is in
 * which column, which edges exist, and what each card says.
 */
describe('AdoptionPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const ADOPTION_URL = '/maintenance/api/adoption/by-release';

  /** The projects the chrome knows, so `/qits/…` parses as a project and `/adoption/…` does not. */
  const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

  const ROOT = 'qits-eventstream';

  const adopter = (over: Partial<AdopterDto> = {}): AdopterDto => ({
    repository: 'qits-ci-frontend',
    catalogId: 'r1',
    repositoryStatus: 'OK',
    archetype: 'FRONTEND',
    depth: 1,
    via: [ROOT],
    state: 'ADOPTED',
    adoptedVersion: '2026.905.7',
    adoptedAt: '2026-08-21T09:10:00Z',
    ...over,
  });

  /** A repository that has not taken the release — the ordinary state, and never a failure. */
  const pending = (over: Partial<AdopterDto> = {}): AdopterDto =>
    adopter({ state: 'PENDING', adoptedVersion: null, adoptedAt: null, ...over });

  const journey = (over: Partial<AdoptionJourneyDto> = {}): AdoptionJourneyDto => ({
    repository: ROOT,
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

  /** One card, by the repository it is about — which is also the proof there is only ever one. */
  function card(repository: string): HTMLElement | null {
    const found = page().querySelectorAll<HTMLElement>(`.node[data-repository="${repository}"]`);
    expect(found.length).toBeLessThan(2);
    return found[0] ?? null;
  }

  function cardText(repository: string): string {
    return card(repository)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function names(): readonly string[] {
    return Array.from(page().querySelectorAll<HTMLElement>('.node')).map(
      (node) => node.dataset['repository'] ?? '',
    );
  }

  /** The repositories in one column, top to bottom — the ordering decision, made visible. */
  function column(index: number): readonly string[] {
    return Array.from(page().querySelectorAll<HTMLElement>(`.node[data-column="${index}"]`))
      .sort((left, right) => Number(left.dataset['row']) - Number(right.dataset['row']))
      .map((node) => node.dataset['repository'] ?? '');
  }

  /** Every edge as the pair it joins. The same attributes make the SVG readable in a browser. */
  function edges(): readonly string[] {
    return Array.from(page().querySelectorAll('path.edge')).map(
      (path) => `${path.getAttribute('data-from')}->${path.getAttribute('data-to')}`,
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
   * The release is the first card, and it is a card rather than a heading: every edge on the page
   * starts somewhere, and the depth-1 edges start here.
   */
  it('draws the release itself as the first column', async () => {
    await open(journey());

    const root = card(ROOT);
    expect(root?.classList.contains('node-root')).toBe(true);
    expect(root?.dataset['column']).toBe('0');
    expect(root?.textContent).toContain('2026.905.1');
    expect(page().querySelector('.column-head[data-depth="0"]')?.textContent).toContain(
      'This release',
    );
    http.verify();
  });

  /**
   * A column per hop, and the old depth header's count kept on top of it. This is the whole point
   * of the redesign: distance is a position now, not a sentence a reader has to hold in their head
   * while looking at rows that never repeat it.
   */
  it('puts each repository in the column its distance names, and counts the column', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          pending({ repository: 'qits-idp-frontend', catalogId: 'r2', depth: 1 }),
          pending({
            repository: 'qits-ci-service',
            catalogId: 'r3',
            archetype: 'SERVICE',
            depth: 2,
            via: ['qits-ci-frontend'],
          }),
        ],
      }),
    );

    expect(column(0)).toEqual([ROOT]);
    expect(column(1)).toEqual(['qits-ci-frontend', 'qits-idp-frontend']);
    expect(column(2)).toEqual(['qits-ci-service']);

    const first = page().querySelector('.column-head[data-depth="1"]')?.textContent ?? '';
    expect(first).toContain('1 hop downstream');
    expect(first).toContain('1/2 carrying it');
    const second = page().querySelector('.column-head[data-depth="2"]')?.textContent ?? '';
    expect(second).toContain('2 hops downstream');
    expect(second).toContain('0/1 carrying it');

    expect(page().querySelector('figcaption')?.textContent).toContain(
      '3 repositories downstream of this release, 1 carrying it',
    );
    http.verify();
  });

  /**
   * **The merged node, which is the reason this is a chart and not a tree.** Two upstreams both
   * lead to one repository — a service that pins a library directly and submodules a frontend
   * carrying it — and the service decides it once. So it is drawn once, with an edge in from each
   * parent; a tree would have to copy the card under both and the copies would say the same thing
   * twice while suggesting the release arrives there twice.
   */
  it('draws a repository two upstreams reach once, with an edge in from each of them', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          adopter({ repository: 'qits-idp-frontend', catalogId: 'r2', depth: 1 }),
          pending({
            repository: 'qits-ci-service',
            catalogId: 'r3',
            depth: 2,
            via: ['qits-ci-frontend', 'qits-idp-frontend'],
          }),
        ],
      }),
    );

    expect(names().filter((name) => name === 'qits-ci-service')).toHaveLength(1);
    expect(edges()).toEqual([
      `${ROOT}->qits-ci-frontend`,
      `${ROOT}->qits-idp-frontend`,
      'qits-ci-frontend->qits-ci-service',
      'qits-idp-frontend->qits-ci-service',
    ]);
    // What the arrows say, for a reader who cannot see them — the fact the old sentence got wrong.
    expect(cardText('qits-ci-service')).toContain(
      'Reached from qits-ci-frontend, qits-idp-frontend',
    );
    http.verify();
  });

  /**
   * A depth-1 adopter hangs off the release, and only once. The service does name the root in
   * `via` at depth 1, so the fallback that guarantees the edge and the `via` entry that describes
   * it are the same edge — drawing both would put two curves on top of each other.
   */
  it('joins every depth-1 repository to the release exactly once', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          // A `via` the service would not send, to prove the edge does not depend on it.
          adopter({ repository: 'qits-idp-frontend', catalogId: 'r2', depth: 1, via: [] }),
        ],
      }),
    );

    expect(edges()).toEqual([`${ROOT}->qits-ci-frontend`, `${ROOT}->qits-idp-frontend`]);
    http.verify();
  });

  /**
   * `DownstreamResolver` bounds both the depth and the breadth of a closure and says so in a WARN
   * rather than by failing, so a truncated answer can name a parent it never sent. The card is
   * still drawn — a repository that is downstream is downstream whether or not this answer can say
   * through what — and the edge into empty space is not.
   */
  it('drops an edge whose parent is not on the chart, and keeps the card', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          pending({
            repository: 'qits-ci-service',
            catalogId: 'r3',
            depth: 2,
            via: ['qits-never-sent'],
          }),
        ],
      }),
    );

    expect(card('qits-ci-service')).not.toBeNull();
    expect(edges()).toEqual([`${ROOT}->qits-ci-frontend`]);
    http.verify();
  });

  /**
   * **The rows in a column are ordered here**, and this is the one place in the application that
   * re-orders what the service sent. A card sits at the mean row of its parents, ties by name,
   * which pulls it level with what feeds it; name order alone would cross the two edges below over
   * each other for no reason a reader could see. The service's own order is not depended on beyond
   * "depth ascending", which is why the answer here arrives shuffled.
   */
  it('orders a column by where its parents sit rather than by name', async () => {
    await open(
      journey({
        adopters: [
          adopter({ repository: 'qits-b', catalogId: 'rb', depth: 1 }),
          adopter({ repository: 'qits-a', catalogId: 'ra', depth: 1 }),
          // qits-x hangs off the lower parent and qits-y off the upper one, so name order is wrong.
          pending({ repository: 'qits-x', catalogId: 'rx', depth: 2, via: ['qits-b'] }),
          pending({ repository: 'qits-y', catalogId: 'ry', depth: 2, via: ['qits-a'] }),
        ],
      }),
    );

    expect(column(1)).toEqual(['qits-a', 'qits-b']);
    expect(column(2)).toEqual(['qits-y', 'qits-x']);
    http.verify();
  });

  /** The two states, and the two different things a card has to say about itself. */
  it('names the version an adopter carries and when, and says a deep one is waiting', async () => {
    await open(
      journey({
        adopters: [
          adopter(),
          pending({
            repository: 'qits-ci-service',
            catalogId: 'r3',
            depth: 2,
            via: ['qits-ci-frontend'],
          }),
        ],
      }),
    );

    const carrying = cardText('qits-ci-frontend');
    expect(carrying).toContain('ADOPTED');
    expect(carrying).toContain('2026.905.7');
    expect(carrying).toContain('3h ago');

    const waiting = cardText('qits-ci-service');
    expect(waiting).toContain('PENDING');
    expect(waiting).toContain('waiting');
    expect(waiting).not.toContain('2026.905.7');
    // The via-chain sentence is gone: `via` is the parents, and the edges are where they are said.
    expect(page().textContent).not.toContain('waiting behind');
    http.verify();
  });

  /** Nothing above it to wait on: a direct consumer that has simply not released since. */
  it('says a pending repository one hop away is waiting on its own next release', async () => {
    await open(journey({ adopters: [pending()] }));

    expect(cardText('qits-ci-frontend')).toContain('has not released with it yet');
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
          adopter({ repository: 'qits-retired', catalogId: 'r4', repositoryStatus: 'ABSENT' }),
          adopter({ repository: 'qits-unknown', catalogId: null, repositoryStatus: null }),
        ],
      }),
    );

    const links = Array.from(page().querySelectorAll('.node a')).map((anchor) =>
      anchor.getAttribute('href'),
    );
    expect(links).toContain('/repositories/qits-ci-frontend');
    expect(links).not.toContain('/repositories/qits-unknown');
    expect(card('qits-unknown')?.querySelector('a')).toBeNull();
    expect(card('qits-retired')?.querySelector('.absent')?.textContent).toContain('absent');
    http.verify();
  });

  /** In-app links keep the project the address names, as everywhere else in this application. */
  it('keeps the scoped project in the links it draws', async () => {
    await open(journey(), '/qits/adoption/qits-eventstream/2026.905.1');

    expect(card(ROOT)?.querySelector('a')?.getAttribute('href')).toBe(
      '/qits/repositories/qits-eventstream',
    );
    expect(card('qits-ci-frontend')?.querySelector('a')?.getAttribute('href')).toBe(
      '/qits/repositories/qits-ci-frontend',
    );
    http.verify();
  });

  it('says a release reached nothing rather than drawing a chart of one card', async () => {
    await open(journey({ adopters: [] }));

    expect(page().querySelector('.chart')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('downstream of this release');
    http.verify();
  });

  /**
   * A release this service holds no packages for. The closure below it is still true, so this is a
   * sentence above the drawing rather than an error instead of it — a chart of pending cards with
   * no explanation would read as a platform that had stopped.
   */
  it('says so when it knows of nothing the release published', async () => {
    await open(journey({ packages: [], adopters: [pending()] }));

    expect(page().querySelector('.note')?.textContent).toContain('knows of nothing published');
    expect(page().querySelectorAll('.node').length).toBeGreaterThan(1);
    http.verify();
  });

  /**
   * Nothing polls here — a pending card moves when a downstream repository releases — so the reader
   * is offered the same question again instead, and pressing it re-issues the one call.
   */
  it('asks the same question again on request', async () => {
    await open(journey());

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();
    adoptionRequest().flush(journey({ adopters: [adopter({ adoptedVersion: '2026.905.9' })] }));
    await settle();

    expect(cardText('qits-ci-frontend')).toContain('2026.905.9');
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

    expect(card('qits-ci-frontend')).not.toBeNull();
    http.verify();
  });
});
