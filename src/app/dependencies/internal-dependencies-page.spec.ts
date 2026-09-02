import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { ArtifactDto, DependentDto, DependentsDto } from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';

/**
 * "What is still shipping an old copy of this", and the URL that carries the question.
 *
 * The rules this spec is about: **the subject lives in the URL**, as two query parameters, so an
 * answer is shareable and the back button means "the previous artifact"; and **up to date is an
 * equality against the subject's own latest**, which is the only version comparison this
 * application makes — with UNKNOWN, never success, when nothing knows what the latest is.
 */
describe('InternalDependenciesPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const ARTIFACTS_URL = '/maintenance/api/artifacts';
  const DEPENDENTS_URL = '/maintenance/api/dependencies/dependents';

  const artifact = (over: Partial<ArtifactDto> = {}): ArtifactDto => ({
    ecosystem: 'npm',
    name: '@qits/ui-components',
    repository: 'qits-platform-ui-jslib',
    latest: '2026.824.155425',
    version: '2026.824.155425',
    occurredAt: '2026-08-24T15:54:25Z',
    sbomStatus: 'INGESTED',
    dependentCount: 6,
    behindCount: 2,
    ...over,
  });

  const dependent = (over: Partial<DependentDto> = {}): DependentDto => ({
    artifactEcosystem: 'npm',
    artifactName: 'qits-platform-spa-maintenance',
    artifactVersion: '2026.824.170632',
    repository: 'qits-maintenance-platform-frontend',
    embeddedVersion: '2026.824.155425',
    direct: true,
    occurredAt: '2026-08-24T17:06:32Z',
    sbomStatus: 'INGESTED',
    ...over,
  });

  const dependents = (over: Partial<DependentsDto> = {}): DependentsDto => ({
    ecosystem: 'npm',
    name: '@qits/ui-components',
    latest: '2026.824.155425',
    dependents: [dependent()],
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
        { provide: QITS_SCHEDULER, useValue: new ManualScheduler() },
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

  function artifactsRequest() {
    return http.expectOne((candidate) => candidate.url === ARTIFACTS_URL);
  }

  function dependentsRequest() {
    return http.expectOne((candidate) => candidate.url === DEPENDENTS_URL);
  }

  async function open(url: string, rows: readonly ArtifactDto[] = [artifact()]): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
    artifactsRequest().flush(rows);
    await settle();
  }

  it('lists what the platform publishes, with its reach and how much of it is stale', async () => {
    await open('/internal/dependencies');

    const row = page().querySelector('tbody tr');
    expect(row?.textContent).toContain('@qits/ui-components');
    expect(row?.textContent).toContain('qits-platform-ui-jslib');
    expect(row?.textContent).toContain('INGESTED');
    // A library whose dependents have fallen behind is the reason the listing exists.
    expect(row?.className).toContain('row-pending');
    http.verify();
  });

  it('leaves a library nothing is behind on quiet', async () => {
    await open('/internal/dependencies', [artifact({ behindCount: 0 })]);

    expect(page().querySelector('tbody tr')?.className).not.toContain('row-pending');
    http.verify();
  });

  /** The subject holds a slash, so it goes in the query string — and that is what makes it a link. */
  it('puts the artifact a name links to in the query string', async () => {
    await open('/internal/dependencies');

    const link = page().querySelector<HTMLAnchorElement>('tbody tr a');
    expect(link?.getAttribute('href')).toContain('ecosystem=npm');
    // The slash is escaped by the router, which is the point of it being a parameter at all.
    expect(link?.getAttribute('href')).toContain('name=@qits%2Fui-components');

    link!.click();
    await settle();
    dependentsRequest().flush(dependents());
    await settle();

    expect(TestBed.inject(Router).url).toContain('name=@qits%2Fui-components');
    expect(page().querySelector('h1')?.textContent).toContain('@qits/ui-components');
    http.verify();
  });

  it('asks for the dependents of what a pasted URL names, both halves of it', async () => {
    await open('/internal/dependencies?ecosystem=npm&name=@qits/ui-components');

    const request = dependentsRequest();
    expect(request.request.params.get('ecosystem')).toBe('npm');
    expect(request.request.params.get('name')).toBe('@qits/ui-components');
    request.flush(dependents());
    await settle();

    expect(page().querySelector('table')).not.toBeNull();
    expect(page().querySelector('.crumbs')?.textContent).toContain('Internal dependencies');
    expect(page().querySelector('.facts')?.textContent).toContain('2026.824.155425');
    http.verify();
  });

  /** Equality against the subject's latest, which is the one version comparison a client may make. */
  it('calls a dependent on the latest current, and one on anything else behind', async () => {
    await open('/internal/dependencies?ecosystem=npm&name=@qits/ui-components');
    dependentsRequest().flush(
      dependents({
        dependents: [
          dependent(),
          dependent({ repository: 'qits-ci-frontend', embeddedVersion: '2026.811.1' }),
        ],
      }),
    );
    await settle();

    const rows = page().querySelectorAll('app-dependents-table tbody tr');
    expect(rows[0].textContent).toContain('CURRENT');
    expect(rows[1].textContent).toContain('BEHIND');
    http.verify();
  });

  /** Silence is not success: with no latest known, no row may claim to be up to date. */
  it('says UNKNOWN when nothing knows what the newest version is', async () => {
    await open('/internal/dependencies?ecosystem=npm&name=@qits/ui-components');
    dependentsRequest().flush(dependents({ latest: null }));
    await settle();

    expect(page().querySelector('app-dependents-table tbody tr')?.textContent).toContain('UNKNOWN');
    http.verify();
  });

  it('says nothing embeds it rather than drawing blank space', async () => {
    await open('/internal/dependencies?ecosystem=npm&name=@qits/ui-components');
    dependentsRequest().flush(dependents({ dependents: [] }));
    await settle();

    expect(page().querySelector('app-dependents-table')).toBeNull();
    expect(page().querySelector('app-empty')?.textContent).toContain('Nothing on the platform');
    http.verify();
  });

  it('reports a failed listing and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/internal/dependencies');
    await settle();
    artifactsRequest().flush(
      { message: 'nope' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle();

    expect(page().textContent).toContain('503 nope');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    artifactsRequest().flush([artifact()]);
    await settle();

    expect(page().querySelector('tbody tr')?.textContent).toContain('@qits/ui-components');
    http.verify();
  });
});
