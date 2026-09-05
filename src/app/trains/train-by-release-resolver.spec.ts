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
import type { TrainDto } from '../api/dto';
import { routes } from '../app.routes';
import { ManualScheduler } from '../testing/manual-scheduler';
import { QITS_SCHEDULER } from '../ui/scheduler';

/**
 * The address a link from a release lands on, and the two answers it has.
 *
 * A hit **replaces** the URL rather than pushing one, so pressing back returns to whatever linked
 * here instead of to this page — which would resolve again and bounce the reader straight forward.
 *
 * A miss is a sentence and not an error page: most releases the platform has ever made predate
 * train tracking, and a release nothing consumes opens no train either. Neither is a fault. A 503
 * is, and it must still look like one.
 */
const PROJECTS = [{ id: 'p-1', slug: 'qits', name: 'QITS' }];

describe('TrainByReleaseResolver', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const MISS = '/qits/trains/by-release/qits-ci/2026.101.1';

  const train = (id: string): TrainDto => ({
    id,
    repository: 'qits-eventstream',
    version: '2026.905.1',
    status: 'COMPLETED',
    createdAt: '2026-09-05T09:00:00Z',
    completedAt: '2026-09-05T10:00:00Z',
    supersededBy: null,
    packages: [],
    nodes: [],
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

  async function settle(rounds = 6): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function lookup() {
    return http.expectOne((candidate) => candidate.url === '/maintenance/api/trains/by-release');
  }

  /** A repository name with a space in it, so the round trip through the URL is under test too. */
  it('redirects to the train the release opened, replacing the address it arrived at', async () => {
    harness = await RouterTestingHarness.create(
      '/qits/trains/by-release/qits%20eventstream/2026.905.1',
    );
    await settle();

    const request = lookup();
    expect(request.request.params.get('repository')).toBe('qits eventstream');
    expect(request.request.params.get('version')).toBe('2026.905.1');
    request.flush(train('t-7'));
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/trains/t-7');
    // The journey is loading now; this spec is about the hop, not about what it lands on.
    http.expectOne('/maintenance/api/trains/t-7').flush(train('t-7'));
  });

  it('says so calmly when the release predates train tracking, and offers to look again', async () => {
    harness = await RouterTestingHarness.create(MISS);
    await settle();
    lookup().flush(
      { message: 'no release train for qits-ci 2026.101.1' },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();

    const text = (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No train recorded for this release');
    expect(text).toContain('predates train tracking');
    expect(text).toContain('Look again');
    // A refusal that is ordinary must not also be drawn as an alert.
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('.async-error')).toBeNull();
    // Nowhere to go: the address the reader arrived at is still the address.
    expect(TestBed.inject(Router).url).toBe(MISS);
  });

  it('looks again on request, and redirects when the train has arrived since', async () => {
    harness = await RouterTestingHarness.create(MISS);
    await settle();
    lookup().flush(
      { message: 'no release train for qits-ci 2026.101.1' },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();

    const button = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'qits-button button',
    );
    button!.click();
    await settle();
    lookup().flush(train('t-8'));
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/trains/t-8');
    http.expectOne('/maintenance/api/trains/t-8').flush(train('t-8'));
  });

  /** A service that is down is not a release without a train, and must not read like one. */
  it('reports anything that is not a 404 as the failure it is', async () => {
    harness = await RouterTestingHarness.create(MISS);
    await settle();
    lookup().flush({ message: 'githost is down' }, { status: 503, statusText: 'Down' });
    await settle();

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.async-error')?.textContent).toContain('503 githost is down');
    expect(element.textContent).not.toContain('predates train tracking');
  });
});
