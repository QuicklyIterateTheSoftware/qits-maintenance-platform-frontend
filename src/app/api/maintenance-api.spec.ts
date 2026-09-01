import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MaintenanceApi } from './maintenance-api';

/**
 * The ten calls, at the addresses qits-platform-maintenance serves them at.
 *
 * The assertions worth having are the ones that are invisible on screen when they are wrong:
 * **every path is relative**, because a configured origin would leave the edge's session cookie
 * behind and turn every read into a 401; **the verbs are right**, because the two POSTs here start
 * real work and a GET that should have been a POST fails silently as a 405; **a name is encoded**,
 * because a dependency name holds slashes and colons; and **a failure reaches the caller whole**,
 * because the pages draw the service's own sentence from it — and because the 409 the bump button
 * depends on is only distinguishable by its status.
 */
describe('MaintenanceApi', () => {
  let api: MaintenanceApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(MaintenanceApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the repositories at a relative path, as a bare array', async () => {
    const repositories = api.repositories();

    const request = http.expectOne('/maintenance/api/repositories');
    expect(request.request.method).toBe('GET');
    request.flush([{ name: 'qits-ci', pending: 2, groups: [] }]);

    expect((await repositories).map((repository) => repository.name)).toEqual(['qits-ci']);
  });

  it('reads one repository by name, with its pins', async () => {
    const repository = api.repository('qits-ci');

    const request = http.expectOne('/maintenance/api/repositories/qits-ci');
    expect(request.request.method).toBe('GET');
    request.flush({ name: 'qits-ci', pins: [{ name: '@qits/angular' }] });

    expect((await repository).pins).toHaveLength(1);
  });

  it('searches dependencies by a glob in a query parameter, never in the path', async () => {
    const dependencies = api.dependencies('@qits/*');

    const request = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/dependencies',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('name')).toBe('@qits/*');
    request.flush([{ ecosystem: 'npm', name: '@qits/angular', latest: '2026.8.4', pins: [] }]);

    expect((await dependencies)[0].name).toBe('@qits/angular');
  });

  /** The half of the inventory is the service's filter; it is sent only when one was asked for. */
  it('narrows a dependency search to one kind, and only when asked', async () => {
    const external = api.dependencies('io.quarkus:*', 'EXTERNAL');
    const narrowed = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/dependencies',
    );
    expect(narrowed.request.params.get('kind')).toBe('EXTERNAL');
    narrowed.flush([]);
    await external;

    const everything = api.dependencies('*');
    const wide = http.expectOne((candidate) => candidate.url === '/maintenance/api/dependencies');
    expect(wide.request.params.has('kind')).toBe(false);
    wide.flush([]);
    await everything;
  });

  it('lists what the platform publishes, as a bare array', async () => {
    const artifacts = api.artifacts();

    const request = http.expectOne('/maintenance/api/artifacts');
    expect(request.request.method).toBe('GET');
    request.flush([{ ecosystem: 'npm', name: '@qits/ui-components', dependentCount: 4 }]);

    expect((await artifacts)[0].name).toBe('@qits/ui-components');
  });

  /** A name holds a slash and a coordinate holds a colon, so neither half is ever a path segment. */
  it('asks what embeds a dependency with both halves as query parameters', async () => {
    const dependents = api.artifactDependents('npm', '@qits/ui-components');

    const request = http.expectOne(
      (candidate) => candidate.url === '/maintenance/api/dependencies/dependents',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('ecosystem')).toBe('npm');
    expect(request.request.params.get('name')).toBe('@qits/ui-components');
    request.flush({ ecosystem: 'npm', name: '@qits/ui-components', latest: '1', dependents: [] });

    expect((await dependents).latest).toBe('1');
  });

  it('asks what consumes a repository at the repository’s own address', async () => {
    const dependents = api.repositoryDependents('qits-ci');

    const request = http.expectOne('/maintenance/api/repositories/qits-ci/dependents');
    expect(request.request.method).toBe('GET');
    request.flush({ repository: 'qits-ci', artifacts: [] });

    expect((await dependents).repository).toBe('qits-ci');
  });

  it('starts a scan with a POST carrying the scope, and nothing else', async () => {
    const scan = api.startScan('INTERNAL');

    const request = http.expectOne('/maintenance/api/scans');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ scope: 'INTERNAL' });
    request.flush({ id: 'scan-1' }, { status: 202, statusText: 'Accepted' });

    expect((await scan).id).toBe('scan-1');
  });

  it('names a repository in the scan body only when one was asked for', async () => {
    const scan = api.startScan('ALL', 'qits-ci');

    const request = http.expectOne('/maintenance/api/scans');
    expect(request.request.body).toEqual({ scope: 'ALL', repository: 'qits-ci' });
    request.flush({ id: 'scan-2' }, { status: 202, statusText: 'Accepted' });
    await scan;
  });

  it('asks for a group’s branch at the group’s own address', async () => {
    const bump = api.startBump('qits-ci', 'dependencies');

    const request = http.expectOne(
      '/maintenance/api/repositories/qits-ci/groups/dependencies/bumps',
    );
    expect(request.request.method).toBe('POST');
    request.flush({ id: 'bump-1' }, { status: 202, statusText: 'Accepted' });

    expect((await bump).id).toBe('bump-1');
  });

  /** The one status the bump button reads rather than reports, so it must arrive intact. */
  it('lets a 409 through to the caller as a 409', async () => {
    const bump = api.startBump('qits-ci', 'angular');

    http
      .expectOne('/maintenance/api/repositories/qits-ci/groups/angular/bumps')
      .flush({ message: 'a bump is already running' }, { status: 409, statusText: 'Conflict' });

    await expect(bump).rejects.toMatchObject({ status: 409 });
  });

  it('lists the bumps for one repository, and for all of them', async () => {
    const mine = api.bumps('qits-ci');
    const listing = http.expectOne((candidate) => candidate.url === '/maintenance/api/bumps');
    expect(listing.request.params.get('repository')).toBe('qits-ci');
    expect(listing.request.params.get('limit')).toBe('20');
    listing.flush([]);
    await mine;

    const all = api.bumps();
    const every = http.expectOne((candidate) => candidate.url === '/maintenance/api/bumps');
    expect(every.request.params.has('repository')).toBe(false);
    every.flush([]);
    await all;
  });

  it('reads one bump by id', async () => {
    const bump = api.bump('bump-1');

    const request = http.expectOne('/maintenance/api/bumps/bump-1');
    expect(request.request.method).toBe('GET');
    request.flush({ id: 'bump-1', changes: [] });

    expect((await bump).id).toBe('bump-1');
  });

  it('percent-encodes a name, a group and an id rather than pasting them into the path', async () => {
    const repository = api.repository('a/b');
    http.expectOne('/maintenance/api/repositories/a%2Fb').flush({ name: 'a/b', pins: [] });
    await repository;

    const bump = api.startBump('a/b', 'angular core');
    http
      .expectOne('/maintenance/api/repositories/a%2Fb/groups/angular%20core/bumps')
      .flush({ id: 'x' }, { status: 202, statusText: 'Accepted' });
    await bump;
  });

  it('rejects with the service’s own message rather than swallowing it', async () => {
    const repositories = api.repositories();

    http
      .expectOne('/maintenance/api/repositories')
      .flush({ message: 'no' }, { status: 503, statusText: 'Service Unavailable' });

    await expect(repositories).rejects.toMatchObject({ status: 503, error: { message: 'no' } });
  });
});
