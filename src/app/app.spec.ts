import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { QitsNavSubmenuSlot, provideQitsNavigationLinks } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';
import { QITS_SCHEDULER } from './ui/scheduler';
import { ManualScheduler } from './testing/manual-scheduler';

/**
 * A fixture navigation, not the platform's. `provideQitsNavigationLinks` answers the layout's
 * `QITS_NAVIGATION` from a literal, so the chrome makes no `/main-navigation` request — which is
 * what keeps `http.verify()` honest instead of failing on a call this file never asked for.
 */
const NAV = [
  { label: 'Deployments', href: '/platform-deployments/' },
  { label: 'Maintenance', href: '/maintenance/' },
] as const;

/**
 * The shell owns two things — the outlet and the sub-menu — so those are what is asserted here,
 * plus the route table putting every door inside the chrome.
 *
 * The layout assertion is not ceremony. These pages are an administrator's, and one accidentally
 * mounted outside `QitsMainLayout` would be a screen that writes branches across the platform with
 * no way back to anything — invisible on the page itself and a two-character edit away in this
 * table.
 */
describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
        { provide: QITS_SCHEDULER, useValue: new ManualScheduler() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /**
   * The sub-menu is *offered*, not drawn: it is an `<ng-template>` the layout renders somewhere
   * else, so the shell on its own paints an outlet and nothing at all.
   */
  it('is an outlet and an offered sub-menu, and no page of its own', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('h1')).toBeNull();
    expect(TestBed.inject(QitsNavSubmenuSlot).template()).not.toBeNull();
    http.verify();
  });

  it('draws the repositories overview at the base path, inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/');
    http.expectOne('/maintenance/api/repositories').flush([]);
    http.expectOne((candidate) => candidate.url === '/maintenance/api/bumps').flush([]);
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelectorAll('nav a').length).toBeGreaterThanOrEqual(NAV.length);
    expect(layout.querySelector('main app-repositories-page')).not.toBeNull();
    http.verify();
  });

  it('routes a repository name to its page, still inside the chrome', async () => {
    const harness = await RouterTestingHarness.create('/repositories/qits-ci');
    http.expectOne('/maintenance/api/repositories/qits-ci').flush({ name: 'qits-ci', pins: [] });
    http.expectOne((candidate) => candidate.url === '/maintenance/api/bumps').flush([]);
    http
      .expectOne('/maintenance/api/repositories/qits-ci/dependents')
      .flush({ repository: 'qits-ci', artifacts: [] });
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-repository-page')).not.toBeNull();
    http.verify();
  });

  it('routes the external dependency search, which asks for nothing until it is asked', async () => {
    const harness = await RouterTestingHarness.create('/external/dependencies');
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('main app-dependencies-page')).not.toBeNull();
    http.verify();
  });

  it('routes the internal dependency listing, which reads the artifacts on arrival', async () => {
    const harness = await RouterTestingHarness.create('/internal/dependencies');
    http.expectOne('/maintenance/api/artifacts').flush([]);
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('main app-internal-dependencies-page')).not.toBeNull();
    http.verify();
  });

  it('routes a bump id to its page', async () => {
    const harness = await RouterTestingHarness.create('/bumps/bump-1');
    http.expectOne('/maintenance/api/bumps/bump-1').flush({ id: 'bump-1', changes: [] });
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('main app-bump-page')).not.toBeNull();
    http.verify();
  });

  it('draws an unknown URL as a page, still inside the chrome', async () => {
    // Two segments, because one is now the project form: `/nothing-here` is read as a project this
    // platform does not have, and the repositories page is the honest answer there.
    const harness = await RouterTestingHarness.create('/nothing/here');

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.tagName.toLowerCase()).toBe('qits-main-layout');
    expect(layout.querySelector('main app-not-found')).not.toBeNull();
    http.verify();
  });
});
