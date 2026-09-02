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
import { routes } from './app.routes';
import { ManualScheduler } from './testing/manual-scheduler';
import { QITS_SCHEDULER } from './ui/scheduler';

/**
 * The URL grammar, asserted where it is cheapest to get wrong: every page is reachable twice — at
 * the root of this host and under a project slug — this app's own first segments still win, and the
 * two redirects land where they say they do.
 *
 * `app.spec.ts` asserts what the shell draws. This file asserts only that an address reaches the
 * page it names, in both forms.
 */

const NAV = [{ label: 'Maintenance', href: '/maintenance/' }] as const;

/** The projects the chrome knows, so `/qits/…` parses as a project and not as this app's own page. */
const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

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
