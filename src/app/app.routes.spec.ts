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
import { routes } from './app.routes';
import { ManualScheduler } from './testing/manual-scheduler';
import { QITS_SCHEDULER } from './ui/scheduler';

/**
 * The URL grammar, asserted where it is cheapest to get wrong: every page is reachable twice — at
 * the root of this host and under a project slug — and this app's own first segments still win.
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

  it('serves the repositories page at the root and under a project slug', async () => {
    const harness = await RouterTestingHarness.create('/qits');
    http.expectOne('/maintenance/api/repositories').flush({ repositories: [] });
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-repositories-page'),
    ).not.toBeNull();
  });

  it('serves the dependencies page under a project slug', async () => {
    const harness = await RouterTestingHarness.create('/qits/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-dependencies-page'),
    ).not.toBeNull();
  });

  it('lets this app own its literal first segments, ahead of the project form', async () => {
    // `/dependencies` is this app's own page and not a project of that name: the literal routes are
    // listed before `:project`, and that order is the whole guard.
    const harness = await RouterTestingHarness.create('/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-dependencies-page'),
    ).not.toBeNull();
  });

  it('names the scoped project in the header', async () => {
    const harness = await RouterTestingHarness.create('/qits/dependencies');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('.project-scope')?.textContent,
    ).toBe('QITS');
  });

  it('names no project at the root, where the address scopes nothing', async () => {
    const harness = await RouterTestingHarness.create('/dependencies');
    await harness.fixture.whenStable();

    expect((harness.routeNativeElement as HTMLElement).querySelector('.project-scope')).toBeNull();
  });
});
