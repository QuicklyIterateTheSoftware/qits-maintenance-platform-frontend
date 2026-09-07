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
import type { AdoptionJourneyDto } from './api/dto';
import { routes } from './app.routes';
import { ManualScheduler } from './testing/manual-scheduler';
import { QITS_SCHEDULER } from './ui/scheduler';

/**
 * The URL grammar, asserted where it is cheapest to get wrong: every page is reachable twice — at
 * the root of this host and under a project slug — this app's own first segments still win, and the
 * three redirects land where they say they do, including the retired `trains/by-release/…`, which
 * carries both of its parameters into the adoption journey that replaced it.
 *
 * `app.spec.ts` asserts what the shell draws. This file asserts only that an address reaches the
 * page it names, in both forms.
 */

const NAV = [{ label: 'Maintenance', href: '/maintenance/' }] as const;

/** The projects the chrome knows, so `/qits/…` parses as a project and not as this app's own page. */
const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

/** The smallest journey the adoption page will draw: one release and nothing downstream of it. */
const journey = (): AdoptionJourneyDto => ({
  repository: 'qits-eventstream',
  catalogId: 'repo-eventstream',
  version: '2026.905.1',
  packages: [{ ecosystem: 'maven', name: 'eu.wohlben.qits:qits-eventstream' }],
  adopters: [],
});

/** A hop that redirects before it lands takes several turns of the queue, not one. */
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

  /** One release's journey, addressed by the release itself, at the root and under a project slug. */
  it('serves the adoption journey of one release in both forms', async () => {
    const harness = await RouterTestingHarness.create('/adoption/qits-eventstream/2026.905.1');
    await harness.fixture.whenStable();
    const lookup = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/adoption/by-release',
    );
    expect(lookup.request.params.get('repository')).toBe('qits-eventstream');
    expect(lookup.request.params.get('version')).toBe('2026.905.1');
    lookup.flush(journey());
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-adoption-page'),
    ).not.toBeNull();

    await harness.navigateByUrl('/qits/adoption/qits-eventstream/2026.905.1');
    await harness.fixture.whenStable();
    http
      .expectOne((candidate) => candidate.url === '/maintenance/api/adoption/by-release')
      .flush(journey());
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-adoption-page'),
    ).not.toBeNull();
  });

  /**
   * The address a release link landed on while the release trains existed. It is in links that are
   * already out there — qits-projects composes it from a release request — so it survives as a
   * redirect, and both of its parameters travel into the address that replaced it.
   */
  it('redirects the retired trains/by-release to the adoption journey, in both forms', async () => {
    const harness = await RouterTestingHarness.create(
      '/trains/by-release/qits-eventstream/2026.905.1',
    );
    // The redirect and the lazy chunk of what it lands on are several turns of the microtask
    // queue, not one.
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/adoption/qits-eventstream/2026.905.1');
    http
      .expectOne((candidate) => candidate.url === '/maintenance/api/adoption/by-release')
      .flush(journey());
    await settle(harness);

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-adoption-page'),
    ).not.toBeNull();

    await harness.navigateByUrl('/qits/trains/by-release/qits-eventstream/2026.905.1');
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/qits/adoption/qits-eventstream/2026.905.1');
    http
      .expectOne((candidate) => candidate.url === '/maintenance/api/adoption/by-release')
      .flush(journey());
    await settle(harness);
  });

  /**
   * Nothing else under `trains` survives the feature. `trains` is not one of this app's own
   * segments any more, so the listing's old address reads as a project of that name — the same
   * answer any unknown first segment gets — and a train's id, which no page can serve, is not found.
   */
  it('no longer claims the trains segment, and answers a train id with the not-found page', async () => {
    const harness = await RouterTestingHarness.create('/trains');
    http.expectOne('/maintenance/api/repositories').flush([]);
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/trains/internal');

    await harness.navigateByUrl('/trains/t-1');
    await settle(harness);

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-not-found'),
    ).not.toBeNull();
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
