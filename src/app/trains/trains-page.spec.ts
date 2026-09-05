import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { TrainSummaryDto } from '../api/dto';
import { routes } from '../app.routes';
import { ManualScheduler } from '../testing/manual-scheduler';
import { QITS_SCHEDULER } from '../ui/scheduler';

/**
 * The listing, one behaviour at a time.
 *
 * Driven through the router rather than by constructing the component, which is the house pattern:
 * the page is a lazy route and its own address is part of what it is — and here the address carries
 * the question, since `?repository=` is the filter and is the service's rather than this page's.
 *
 * The behaviour worth the most is the one nobody sees until it is wrong: **this page never polls**.
 * A listing of recent releases moves when a release happens, and the reader who wants to watch one
 * travel is a click away on a journey that does.
 */
describe('TrainsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let scheduler: ManualScheduler;

  const TRAINS_URL = '/maintenance/api/trains';

  const train = (over: Partial<TrainSummaryDto> = {}): TrainSummaryDto => ({
    id: 't-1',
    repository: 'qits-eventstream',
    version: '2026.905.1',
    status: 'OPEN',
    createdAt: '2026-08-21T09:00:00Z',
    completedAt: null,
    nodeCount: 2,
    landedCount: 1,
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

  function trainsRequest() {
    return http.expectOne(
      (candidate) => candidate.url === TRAINS_URL && candidate.method === 'GET',
    );
  }

  async function open(trains: readonly TrainSummaryDto[], url = '/trains'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    trainsRequest().flush(trains);
    await settle();
  }

  it('lists a train with its release, when it was created, and how far it has got', async () => {
    await open([train()]);

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('qits-eventstream');
    expect(row?.textContent).toContain('2026.905.1');
    expect(row?.textContent).toContain('1/2');
    expect(row?.textContent).toContain('OPEN');
    http.verify();
  });

  /** The row is a way in, and the id is what the journey is addressed by — never the release. */
  it('links a row to that train’s own journey', async () => {
    await open([train({ id: 't-9' })]);

    expect(page().querySelector('tbody tr a')?.getAttribute('href')).toBe('/trains/t-9');
    http.verify();
  });

  /**
   * The filter is the SERVICE's: a page that dropped rows after the fact would still be paying for
   * them, and would disagree with its own caption about how many there are.
   */
  it('sends the repository in the address to the service, and nowhere else', async () => {
    harness = await RouterTestingHarness.create('/trains?repository=qits-eventstream');
    await settle();

    const request = trainsRequest();
    expect(request.request.params.get('repository')).toBe('qits-eventstream');
    request.flush([train()]);
    await settle();
    http.verify();
  });

  it('asks for every train when the address narrows to none', async () => {
    harness = await RouterTestingHarness.create('/trains');
    await settle();

    const request = trainsRequest();
    expect(request.request.params.has('repository')).toBe(false);
    request.flush([]);
    await settle();
    http.verify();
  });

  /** Submitting the box puts the question in the URL, so back means "the previous question". */
  it('puts a typed repository in the address and re-asks', async () => {
    await open([train()]);

    const input = page().querySelector<HTMLInputElement>('input[name="repository"]');
    input!.value = 'qits-ci';
    input!.dispatchEvent(new Event('input'));
    page().querySelector<HTMLFormElement>('form.search')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(TestBed.inject(Router).url).toContain('repository=qits-ci');
    const request = trainsRequest();
    expect(request.request.params.get('repository')).toBe('qits-ci');
    request.flush([]);
    await settle();
    http.verify();
  });

  it('says the filter found nothing rather than drawing blank space', async () => {
    harness = await RouterTestingHarness.create('/trains?repository=qits-nothing');
    await settle();
    trainsRequest().flush([]);
    await settle();

    expect(page().querySelector('table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('for that repository');
    http.verify();
  });

  it('says the platform has recorded no train at all when nothing is filtered', async () => {
    await open([]);

    expect(page().querySelector('app-empty')?.textContent).toContain(
      'No release train has been recorded yet',
    );
    http.verify();
  });

  /** A listing of releases moves when a release happens; nobody is watching it for change. */
  it('never polls', async () => {
    await open([train({ status: 'OPEN' })]);

    expect(scheduler.count(2000)).toBe(0);
    expect(scheduler.count(5000)).toBe(0);
    http.verify();
  });

  it('reports a failed listing and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/trains');
    await settle();
    trainsRequest().flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().textContent).toContain('503 nope');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    trainsRequest().flush([train()]);
    await settle();

    expect(page().querySelector('tbody tr')?.textContent).toContain('qits-eventstream');
    http.verify();
  });
});
