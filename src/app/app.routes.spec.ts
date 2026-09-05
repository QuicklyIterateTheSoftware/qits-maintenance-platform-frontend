import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationLinks,
  provideQitsProjectList,
  provideQitsScope,
} from '@qits/ui-components';
import type { TrainDto } from './api/dto';
import { routes } from './app.routes';
import { ManualScheduler } from './testing/manual-scheduler';
import { QITS_SCHEDULER } from './ui/scheduler';

/**
 * The URL grammar, asserted where it is cheapest to get wrong: every page is reachable twice — at
 * the root of this host and under a project slug — this app's own first segments still win, the
 * two redirects land where they say they do, and `trains/by-release/…` beats the `trains/:id` it is
 * declared before.
 *
 * `app.spec.ts` asserts what the shell draws. This file asserts only that an address reaches the
 * page it names, in both forms.
 */

const NAV = [{ label: 'Maintenance', href: '/maintenance/' }] as const;

/** The projects the chrome knows, so `/qits/…` parses as a project and not as this app's own page. */
const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

/** The smallest train the journey page will draw: one release and nothing consuming it. */
const train = (id: string): TrainDto => ({
  id,
  repository: 'qits-eventstream',
  repositoryCatalogId: 'repo-eventstream',
  version: '2026.905.1',
  status: 'COMPLETED',
  createdAt: '2026-09-05T09:00:00Z',
  completedAt: '2026-09-05T10:00:00Z',
  supersededBy: null,
  packages: [],
  nodes: [],
});

/** A hop that resolves before it navigates takes several turns of the queue, not one. */
async function settle(harness: RouterTestingHarness, rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
    await harness.fixture.whenStable();
  }
}

describe('routes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
        provideQitsProjectList(PROJECTS),
        provideQitsScope('project'),
        { provide: QITS_SCHEDULER, useValue: new ManualScheduler() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** The bare address of the app, and of a project inside it, is the internal repositories listing. */
  it('redirects the root to the internal listing, at the root and under a project slug', async () => {
    const harness = await RouterTestingHarness.create('/qits');
    http.expectOne('/maintenance/api/repositories').flush([]);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/qits/internal');
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-repositories-page'),
    ).not.toBeNull();
  });

  /** One component, two addresses: the section is route data, and it is what the header says. */
  it('serves the external listing from its own address', async () => {
    const harness = await RouterTestingHarness.create('/qits/external');
    http.expectOne('/maintenance/api/repositories').flush([]);
    await harness.fixture.whenStable();

    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toContain(
      'External',
    );
  });

  it('serves the external dependency search under a project slug', async () => {
    const harness = await RouterTestingHarness.create('/qits/external/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-dependencies-page'),
    ).not.toBeNull();
  });

  it('serves the internal dependency listing under a project slug', async () => {
    const harness = await RouterTestingHarness.create('/qits/internal/dependencies');
    http.expectOne('/maintenance/api/artifacts').flush([]);
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-internal-dependencies-page'),
    ).not.toBeNull();
  });

  /** The address the search had when there was only one of them, still in links that are out there. */
  it('redirects the legacy /dependencies to the internal view', async () => {
    const harness = await RouterTestingHarness.create('/dependencies?name=@qits/*');
    http.expectOne('/maintenance/api/artifacts').flush([]);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toContain('/internal/dependencies');
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-internal-dependencies-page'),
    ).not.toBeNull();
  });

  it('lets this app own its literal first segments, ahead of the project form', async () => {
    // `/external` is this app's own page and not a project of that name: the literal routes are
    // listed before `:project`, and that order is the whole guard.
    const harness = await RouterTestingHarness.create('/external/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-dependencies-page'),
    ).not.toBeNull();
  });

  /** The train listing, at the root of this host and under a project slug. */
  it('serves the release train listing in both forms', async () => {
    const harness = await RouterTestingHarness.create('/trains');
    http.expectOne((candidate) => candidate.url === '/maintenance/api/trains').flush([]);
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-trains-page'),
    ).not.toBeNull();

    await harness.navigateByUrl('/qits/trains');
    http.expectOne((candidate) => candidate.url === '/maintenance/api/trains').flush([]);
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-trains-page'),
    ).not.toBeNull();
  });

  it('serves one journey by the train’s own id, in both forms', async () => {
    const harness = await RouterTestingHarness.create('/trains/t-1');
    http.expectOne('/maintenance/api/trains/t-1').flush(train('t-1'));
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-train-journey-page'),
    ).not.toBeNull();

    await harness.navigateByUrl('/qits/trains/t-2');
    http.expectOne('/maintenance/api/trains/t-2').flush(train('t-2'));
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-train-journey-page'),
    ).not.toBeNull();
  });

  /**
   * The literal is declared before `trains/:id`, and that order is the whole guard: matched the
   * other way round, every release link would ask for a train called `by-release`.
   */
  it('lets by-release beat the id parameter it is listed before, in both forms', async () => {
    const harness = await RouterTestingHarness.create(
      '/trains/by-release/qits-eventstream/2026.905.1',
    );
    await harness.fixture.whenStable();
    const lookup = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/trains/by-release',
    );
    expect(lookup.request.params.get('repository')).toBe('qits-eventstream');
    expect(lookup.request.params.get('version')).toBe('2026.905.1');
    lookup.flush(train('t-9'));
    // The resolve, the navigation and the lazy chunk of what it lands on are three turns of the
    // microtask queue, not one.
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/trains/t-9');
    // The journey is loading now; this assertion is about the hop, not about what it lands on.
    http.expectOne('/maintenance/api/trains/t-9').flush(train('t-9'));
    await settle(harness);

    await harness.navigateByUrl('/qits/trains/by-release/qits-eventstream/2026.905.1');
    await settle(harness);
    http
      .expectOne((candidate) => candidate.url === '/maintenance/api/trains/by-release')
      .flush(train('t-9'));
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/qits/trains/t-9');
    http.expectOne('/maintenance/api/trains/t-9').flush(train('t-9'));
  });

  it('names the scoped project in the header', async () => {
    const harness = await RouterTestingHarness.create('/qits/external/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('.project-scope')?.textContent,
    ).toBe('QITS');
  });

  it('names no project at the root, where the address scopes nothing', async () => {
    const harness = await RouterTestingHarness.create('/external/dependencies');
    await harness.fixture.whenStable();

    expect((harness.routeNativeElement as HTMLElement).querySelector('.project-scope')).toBeNull();
  });
});
