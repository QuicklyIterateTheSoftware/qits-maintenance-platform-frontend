import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { TrainDto, TrainNodeDto } from '../api/dto';
import { routes } from '../app.routes';
import { ManualScheduler } from '../testing/manual-scheduler';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { POLL_INTERVAL_MS } from './train-journey-page';

/**
 * The journey, one behaviour at a time.
 *
 * The three that are worth the most are the ones this page exists for and nobody sees until they
 * are wrong: **the stitching** — the service answers one train and the tree is grown here by
 * following `childTrainId`; **the cycle guard** — a train already asked for is never asked for
 * twice, which is what keeps a loop from being an infinite fetch; and **the polling**, which
 * follows an OPEN train and stops for good when nothing on screen can move again.
 */
describe('TrainJourneyPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const node = (over: Partial<TrainNodeDto> = {}): TrainNodeDto => ({
    id: 'n-1',
    consumer: 'qits-ci',
    consumerCatalogId: 'r1',
    consumerStatus: 'OK',
    archetype: 'SERVICE',
    endKind: 'LINKED',
    state: 'LANDED',
    adoptedVersion: '2026.905.7',
    adoptedAt: '2026-08-21T09:10:00Z',
    childTrainId: null,
    landedAt: '2026-08-21T09:20:00Z',
    ...over,
  });

  const train = (over: Partial<TrainDto> = {}): TrainDto => ({
    id: 't-1',
    repository: 'qits-eventstream',
    version: '2026.905.1',
    status: 'COMPLETED',
    createdAt: '2026-08-21T09:00:00Z',
    completedAt: '2026-08-21T09:30:00Z',
    supersededBy: null,
    packages: [{ ecosystem: 'maven', name: 'eu.wohlben.qits:qits-eventstream' }],
    nodes: [node()],
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

  function trainRequest(id: string) {
    return http.expectOne(
      (candidate) =>
        candidate.url === `/maintenance/api/trains/${id}` && candidate.method === 'GET',
    );
  }

  function rowText(): readonly string[] {
    return Array.from(page().querySelectorAll('tbody tr')).map(
      (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  /** The chevron of the nth node row on screen — the disclosure, not a platform button. */
  function chevrons(): readonly HTMLButtonElement[] {
    return Array.from(page().querySelectorAll<HTMLButtonElement>('tbody .chevron'));
  }

  async function open(root: TrainDto, id = 't-1'): Promise<void> {
    harness = await RouterTestingHarness.create(`/trains/${id}`);
    await settle();
    trainRequest(id).flush(root);
    await settle();
  }

  /** A second address in the same test, through the router rather than through a second harness. */
  async function goTo(root: TrainDto, id: string): Promise<void> {
    await harness.navigateByUrl(`/trains/${id}`);
    await settle();
    trainRequest(id).flush(root);
    await settle();
  }

  it('draws the release as a station with what it published, and its consumers under it', async () => {
    await open(train());

    const rows = rowText();
    expect(rows[0]).toContain('qits-eventstream@2026.905.1');
    expect(rows[0]).toContain('maven eu.wohlben.qits:qits-eventstream');
    expect(rows[0]).toContain('1/1 landed');
    expect(rows[1]).toContain('qits-ci');
    expect(rows[1]).toContain('SERVICE');
    expect(rows[1]).toContain('LINKED');
    expect(rows[1]).toContain('LANDED');
    expect(rows[1]).toContain('2026.905.7');
    http.verify();
  });

  /**
   * The whole point of the page: the service answers one train, and the child it names is fetched
   * and merged into the same tree without the reader asking for it.
   */
  it('follows a node’s child train and grafts it into the tree', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(train({ nodes: [node({ childTrainId: 't-2' })] }));
    await settle();

    trainRequest('t-2').flush(
      train({
        id: 't-2',
        repository: 'qits-ci',
        version: '2026.905.7',
        nodes: [node({ id: 'n-2', consumer: 'qits-workspaces', childTrainId: null })],
      }),
    );
    await settle();

    // Stitched, and said so — but collapsed, because the subtree is a second question.
    expect(page().querySelector('caption')?.textContent).toContain('2 trains stitched');
    expect(rowText().some((row) => row.includes('qits-ci@2026.905.7'))).toBe(false);

    chevrons()[0].click();
    await settle();

    const rows = rowText();
    expect(rows.some((row) => row.includes('qits-ci@2026.905.7'))).toBe(true);
    expect(rows.some((row) => row.includes('qits-workspaces'))).toBe(true);
    http.verify();
  });

  /** One press, and every train this page has is on screen — however deep the chain went. */
  it('opens the whole journey on request', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(train({ nodes: [node({ childTrainId: 't-2' })] }));
    await settle();
    trainRequest('t-2').flush(
      train({
        id: 't-2',
        repository: 'qits-ci',
        version: '2026.905.7',
        nodes: [node({ id: 'n-2', consumer: 'qits-workspaces', childTrainId: 't-3' })],
      }),
    );
    await settle();
    trainRequest('t-3').flush(
      train({ id: 't-3', repository: 'qits-workspaces', version: '2026.905.9', nodes: [] }),
    );
    await settle();

    page().querySelectorAll<HTMLButtonElement>('.actions button')[0].click();
    await settle();

    const rows = rowText();
    expect(rows.some((row) => row.includes('qits-ci@2026.905.7'))).toBe(true);
    expect(rows.some((row) => row.includes('qits-workspaces@2026.905.9'))).toBe(true);
    http.verify();
  });

  /**
   * A train already asked for is never asked for again. Without that, a journey that loops back —
   * two repositories that pin each other across releases — would fetch until the tab died.
   */
  it('asks for a train once, however many nodes point at it', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(
      train({
        nodes: [
          node({ id: 'n-1', consumer: 'qits-ci', childTrainId: 't-2' }),
          node({ id: 'n-2', consumer: 'qits-idp', childTrainId: 't-2' }),
        ],
      }),
    );
    await settle();

    // One request for the shared child, and the loop back to the root costs none at all.
    trainRequest('t-2').flush(
      train({
        id: 't-2',
        repository: 'qits-ci',
        nodes: [node({ id: 'n-3', consumer: 'qits-eventstream', childTrainId: 't-1' })],
      }),
    );
    await settle();

    expect(page().querySelector('caption')?.textContent).toContain('2 trains stitched');
    http.verify();
  });

  /** A node whose train this page is not drawing gets a link rather than silence. */
  it('offers the child train as its own journey when it did not follow it', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(train({ nodes: [node({ childTrainId: 't-2' })] }));
    await settle();
    trainRequest('t-2').flush(
      { message: "no release train 't-2'" },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();

    chevrons()[0].click();
    await settle();

    expect(page().querySelector('.row-continues')?.textContent).toContain('…continues');
    expect(page().querySelector('.row-continues a')?.getAttribute('href')).toBe('/trains/t-2');
    // The branch that failed is reported beside the tree rather than instead of it.
    expect(page().querySelector('.stale')?.textContent).toContain('404');
    expect(page().querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    http.verify();
  });

  /**
   * A consumer the catalog no longer holds will never move. Said on the row, because a journey that
   * waited on it silently would look stuck for a reason nothing on screen explained.
   */
  it('says on the row that a consumer is no longer in the catalog', async () => {
    await open(
      train({
        nodes: [
          node({
            consumer: 'qits-retired',
            consumerCatalogId: null,
            consumerStatus: 'ABSENT',
            archetype: null,
            state: 'PENDING',
            adoptedVersion: null,
            adoptedAt: null,
            landedAt: null,
          }),
        ],
      }),
    );

    expect(page().querySelector('.absent')?.textContent).toContain('absent');
    http.verify();
  });

  /**
   * The detail is where a link goes. Today that is the consumer's repository page, and it is drawn
   * only when the consumer IS a repository — a CONFIG_IMAGE_PIN names an application and has none.
   */
  it('links a repository consumer to the inventory, and links nothing for one that is not', async () => {
    await open(train());
    chevrons()[0].click();
    await settle();

    expect(page().querySelector('.links a')?.getAttribute('href')).toBe('/repositories/qits-ci');

    await goTo(
      train({
        id: 't-4',
        nodes: [
          node({
            consumer: 'qits-ci',
            consumerCatalogId: null,
            consumerStatus: null,
            endKind: 'CONFIG_IMAGE_PIN',
          }),
        ],
      }),
      't-4',
    );
    chevrons()[0].click();
    await settle();

    expect(page().querySelector('.links a')).toBeNull();
    expect(page().querySelector('.row-detail')?.textContent).toContain('not a repository');
    http.verify();
  });

  it('polls while a train is open and re-reads it', async () => {
    await open(train({ status: 'OPEN', completedAt: null, nodes: [node({ state: 'PENDING' })] }));

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    trainRequest('t-1').flush(
      train({ status: 'OPEN', completedAt: null, nodes: [node({ state: 'ADOPTED' })] }),
    );
    await settle();

    expect(rowText()[1]).toContain('ADOPTED');
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);
    http.verify();
  });

  it('stops polling for good when the train completes', async () => {
    await open(train({ status: 'OPEN', completedAt: null }));

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    trainRequest('t-1').flush(train({ status: 'COMPLETED' }));
    await settle();

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  /** A journey made entirely of finished trains is read once; a further read could add nothing. */
  it('never polls a journey that was already settled when it was read', async () => {
    await open(train({ status: 'COMPLETED' }));

    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(0);
    http.verify();
  });

  /** A poll re-reads every train on screen, because a node that adopted names a new child. */
  it('re-reads the stitched trains together and grafts what a poll reveals', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(
      train({ status: 'OPEN', completedAt: null, nodes: [node({ childTrainId: 't-2' })] }),
    );
    await settle();
    trainRequest('t-2').flush(train({ id: 't-2', repository: 'qits-ci', nodes: [] }));
    await settle();

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    trainRequest('t-1').flush(
      train({ status: 'OPEN', completedAt: null, nodes: [node({ childTrainId: 't-2' })] }),
    );
    trainRequest('t-2').flush(
      train({
        id: 't-2',
        repository: 'qits-ci',
        nodes: [node({ id: 'n-9', consumer: 'qits-workspaces', childTrainId: 't-3' })],
      }),
    );
    await settle();

    // The child that only exists as of this poll is fetched in the same pass.
    trainRequest('t-3').flush(train({ id: 't-3', repository: 'qits-workspaces', nodes: [] }));
    await settle();

    expect(page().querySelector('caption')?.textContent).toContain('3 trains stitched');
    http.verify();
  });

  it('keeps the last good tree on screen when a poll fails, and says so', async () => {
    await open(train({ status: 'OPEN', completedAt: null }));

    scheduler.fire(POLL_INTERVAL_MS);
    await settle();
    trainRequest('t-1').flush(null, { status: 0, statusText: 'Unknown Error' });
    await settle();

    expect(page().querySelector('.stale')?.textContent).toContain('unreachable');
    expect(page().querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(scheduler.count(POLL_INTERVAL_MS)).toBe(1);
    http.verify();
  });

  it('reports a train that could not be read and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/trains/t-1');
    await settle();
    trainRequest('t-1').flush(
      { message: "no release train 't-1'" },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();

    expect(page().textContent).toContain('404');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    trainRequest('t-1').flush(train());
    await settle();

    expect(rowText()[0]).toContain('qits-eventstream@2026.905.1');
    http.verify();
  });

  /** A later release retires this one, and the reader's next move is to open the one that took over. */
  it('offers the successor of a superseded train', async () => {
    await open(train({ status: 'SUPERSEDED', supersededBy: 't-99' }));

    expect(page().querySelector('.successor')?.getAttribute('href')).toBe('/trains/t-99');
    http.verify();
  });

  it('says a release reached nothing rather than drawing an empty table', async () => {
    await open(train({ nodes: [] }));

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('reached nothing');
    http.verify();
  });
});
