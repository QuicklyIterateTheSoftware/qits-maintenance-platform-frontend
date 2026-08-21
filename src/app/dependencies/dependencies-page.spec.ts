import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import type { DependencyDto } from '../api/dto';
import { routes } from '../app.routes';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { ManualScheduler } from '../testing/manual-scheduler';

/**
 * "Who still pins this", and the URL that carries the question.
 *
 * The rule this spec is about: **the search lives in the URL**, so an answer is shareable and the
 * back button means "the previous search". Everything else — the request, the table, the empty
 * state — follows from that one signal.
 */
describe('DependenciesPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const URL = '/maintenance/api/dependencies';

  const dependency = (over: Partial<DependencyDto> = {}): DependencyDto => ({
    ecosystem: 'npm',
    name: '@qits/angular',
    latest: '2026.8.4',
    pins: [
      { repository: 'qits-ci', version: '2026.8.1', manifestPath: 'package.json' },
      { repository: 'qits-spa-home', version: '2026.8.4', manifestPath: 'package.json' },
    ],
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

  function searchRequest() {
    return http.expectOne((candidate) => candidate.url === URL);
  }

  it('asks for nothing until something is asked for', async () => {
    harness = await RouterTestingHarness.create('/dependencies');
    await settle();

    expect(page().querySelector('app-empty')?.textContent).toContain('Type a dependency name');
    http.verify();
  });

  it('searches what the URL asks for, and fills the box from it', async () => {
    harness = await RouterTestingHarness.create('/dependencies?name=@qits/*');
    await settle();

    const request = searchRequest();
    expect(request.request.params.get('name')).toBe('@qits/*');
    request.flush([dependency()]);
    await settle();

    expect(page().querySelector<HTMLInputElement>('#dependency-name')?.value).toBe('@qits/*');
    expect(page().querySelector('h2')?.textContent).toContain('@qits/angular');
    expect(page().querySelector('h2')?.textContent).toContain('latest 2026.8.4');
    http.verify();
  });

  it('lists who pins it, and links each one to its repository', async () => {
    harness = await RouterTestingHarness.create('/dependencies?name=@qits/angular');
    await settle();
    searchRequest().flush([dependency()]);
    await settle();

    const rows = page().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/repositories/qits-ci');
    // The first pin is behind the latest, the second is on it.
    expect(rows[0].className).toContain('row-behind');
    expect(rows[1].className).not.toContain('row-behind');
    http.verify();
  });

  it('puts a submitted search in the URL, which is what makes an answer shareable', async () => {
    harness = await RouterTestingHarness.create('/dependencies');
    await settle();

    const input = page().querySelector<HTMLInputElement>('#dependency-name');
    input!.value = 'io.quarkus:*';
    input!.dispatchEvent(new Event('input'));
    page().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(TestBed.inject(Router).url).toContain('name=io.quarkus:*');
    searchRequest().flush([]);
    await settle();

    expect(page().querySelector('app-empty')?.textContent).toContain('No dependency');
    http.verify();
  });

  it('reports a failed search and retries it on request', async () => {
    harness = await RouterTestingHarness.create('/dependencies?name=x');
    await settle();
    searchRequest().flush({ message: 'nope' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(page().textContent).toContain('503 nope');

    page().querySelectorAll<HTMLButtonElement>('app-async button')[0].click();
    await settle();
    searchRequest().flush([dependency()]);
    await settle();

    expect(page().querySelector('h2')?.textContent).toContain('@qits/angular');
    http.verify();
  });

  it('says a dependency nothing pins is exactly that', async () => {
    harness = await RouterTestingHarness.create('/dependencies?name=lonely');
    await settle();
    searchRequest().flush([dependency({ name: 'lonely', pins: [], latest: null })]);
    await settle();

    expect(page().querySelector('section app-empty')?.textContent).toContain('Nothing pins this');
    expect(page().querySelector('h2')?.textContent).toContain('latest —');
    http.verify();
  });
});
