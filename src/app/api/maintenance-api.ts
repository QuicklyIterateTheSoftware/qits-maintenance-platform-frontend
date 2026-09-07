import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  AcceptedDto,
  AdoptionJourneyDto,
  ArtifactDto,
  BumpDto,
  DependencyDto,
  DependentsDto,
  DownstreamDto,
  InventorySection,
  RepositoryDependentsDto,
  RepositoryDetailDto,
  RepositoryDto,
  ScanScope,
} from './dto';

/**
 * Everything this app says to qits-platform-maintenance, through the edge, at `/maintenance/api`.
 *
 * **Ten reads and two writes, and the writes are the point of the application.** A scan refreshes
 * what the platform pins and what the registries hold; a bump asks CI to write the branch. Both
 * answer 202: the work is accepted, not finished, and every page re-reads for anything else.
 *
 * **Five of the reads are about the other direction.** Pins say what a repository consumes;
 * `artifacts`, `artifactDependents` and `repositoryDependents` say what consumes it, read off the
 * bills of materials of what the platform has actually released, and `downstream` and
 * `adoptionByRelease` trace that direction to the end of the chain rather than one hop. Nothing in
 * that half is editable, and none of it is polled.
 *
 * **Every path is relative.** The SPA is served at `/maintenance/` by the service itself, behind
 * the edge that serves `/maintenance/api/…`, so a same-origin absolute path is what lets the
 * browser's session cookie reach the service. A configured origin would move every call
 * cross-origin, leave the cookie behind, and answer 401 with nothing on screen to explain it.
 *
 * **Failures are thrown, not described.** An `HttpErrorResponse` reaching a caller still holds the
 * service's `{"message": …}` body; `ui/loadable.ts` is the one place that body is read. The one
 * status a caller reads rather than reports is the 409 a second bump for a busy group gets.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /** Every repository in the catalog, with its last scan and its groups. */
  repositories(): Promise<readonly RepositoryDto[]> {
    return firstValueFrom(
      this.http.get<RepositoryDto[]>(`${this.base}/maintenance/api/repositories`),
    );
  }

  /** One repository with every pin its manifests hold, and what its artifacts contain. */
  repository(name: string): Promise<RepositoryDetailDto> {
    return firstValueFrom(this.http.get<RepositoryDetailDto>(this.repositoryUrl(name)));
  }

  /**
   * Who pins what, for dependency names matching a glob.
   *
   * The glob is the service's to interpret — `@qits/*`, `eu.wohlben.qits:qits-eventstream` — and is
   * sent as a query parameter rather than a path segment, because a name holds slashes and colons
   * and a reader types both.
   *
   * `kind` narrows the answer to one half of the inventory, and is the service's filter rather than
   * a filter applied here: a page that dropped rows after the fact would still be paying for them,
   * and would disagree with its own caption about how many there are.
   */
  dependencies(name: string, kind?: InventorySection): Promise<readonly DependencyDto[]> {
    let params = new HttpParams().set('name', name);
    if (kind) {
      params = params.set('kind', kind);
    }
    return firstValueFrom(
      this.http.get<DependencyDto[]>(`${this.base}/maintenance/api/dependencies`, { params }),
    );
  }

  /**
   * Everything the platform publishes, newest release first as the service orders it.
   *
   * The order is the SERVICE's and is not re-sorted here, for the reason `bumps` gives: a client
   * sorting the rows would disagree with the caption above them the moment two rows tie.
   */
  artifacts(): Promise<readonly ArtifactDto[]> {
    return firstValueFrom(this.http.get<ArtifactDto[]>(`${this.base}/maintenance/api/artifacts`));
  }

  /**
   * What embeds one dependency, read off the bills of materials of what has been released.
   *
   * Both halves of the coordinate are query parameters and neither is a segment: an npm name holds
   * a slash and a maven one holds a colon, and the ecosystem is what makes the pair unique.
   */
  artifactDependents(ecosystem: string, name: string): Promise<DependentsDto> {
    return firstValueFrom(
      this.http.get<DependentsDto>(`${this.base}/maintenance/api/dependencies/dependents`, {
        params: new HttpParams().set('ecosystem', ecosystem).set('name', name),
      }),
    );
  }

  /** What consumes a repository's own artifacts — the other direction of its pins. */
  repositoryDependents(name: string): Promise<RepositoryDependentsDto> {
    return firstValueFrom(
      this.http.get<RepositoryDependentsDto>(`${this.repositoryUrl(name)}/dependents`),
    );
  }

  /**
   * Everything downstream of a repository, to the end of the chain rather than one hop.
   *
   * `dependents` answers who consumes this repository directly; this answers who consumes THEM as
   * well, and who consumes those, ordered by how far away each is. It is traced per request out of
   * the pins and the bills of materials the service already holds — there is nothing stored to go
   * stale, and nothing here to poll.
   *
   * A name the inventory does not know is an empty answer and not a 404, so a caller composing this
   * from a name it was handed never has to tell the two apart.
   */
  downstream(name: string): Promise<DownstreamDto> {
    return firstValueFrom(
      this.http.get<DownstreamDto>(`${this.repositoryUrl(name)}/downstream`),
    );
  }

  /**
   * How far one release has travelled: who is downstream of it, and which of them have taken it.
   *
   * Both halves are query parameters rather than segments, for the reason `artifactDependents`
   * gives: a version is safe in a path but a repository name need not be, and the pair is one
   * question — the service answers 400 to half of it.
   *
   * **There is no 404 to handle.** The answer is derived from the dependency graph rather than read
   * out of a record that a release was tracked, so a release this service has never seen answers
   * with no packages and a wholly pending closure. The one status a caller must still expect is the
   * ordinary failure of a service that is down.
   */
  adoptionByRelease(repository: string, version: string): Promise<AdoptionJourneyDto> {
    return firstValueFrom(
      this.http.get<AdoptionJourneyDto>(`${this.base}/maintenance/api/adoption/by-release`, {
        params: new HttpParams().set('repository', repository).set('version', version),
      }),
    );
  }

  /**
   * Rescan the catalog and refresh the latest versions.
   *
   * `repository` narrows it to one; leaving it out is the whole platform, which is what the two
   * header buttons do. The service queues this on its one worker, so a second press while one is
   * running is a second queued scan rather than an interleaving.
   */
  startScan(scope: ScanScope, repository?: string): Promise<AcceptedDto> {
    const body = repository ? { scope, repository } : { scope };
    return firstValueFrom(
      this.http.post<AcceptedDto>(`${this.base}/maintenance/api/scans`, body),
    );
  }

  /**
   * Ask for a group's maintenance branch now.
   *
   * A 409 means a bump for this repository and group is already active. That is the service's rule
   * working, not a failure, and it reaches the caller as an `HttpErrorResponse` so the page can say
   * so in a sentence.
   */
  startBump(repository: string, group: string): Promise<AcceptedDto> {
    return firstValueFrom(
      this.http.post<AcceptedDto>(
        `${this.repositoryUrl(repository)}/groups/${encodeURIComponent(group)}/bumps`,
        {},
      ),
    );
  }

  /**
   * Recent bumps, newest first, for one repository or for all of them.
   *
   * The order is the SERVICE's and is not re-sorted here: a client sorting by `startedAt` would
   * disagree with it the moment two bumps share an instant, and the list would reorder itself under
   * the reader's cursor on the next poll.
   */
  bumps(repository?: string, limit = 20): Promise<readonly BumpDto[]> {
    let params = new HttpParams().set('limit', limit);
    if (repository) {
      params = params.set('repository', repository);
    }
    return firstValueFrom(
      this.http.get<BumpDto[]>(`${this.base}/maintenance/api/bumps`, { params }),
    );
  }

  /** One bump with the changes it sent and the CI run it started. */
  bump(id: string): Promise<BumpDto> {
    return firstValueFrom(
      this.http.get<BumpDto>(`${this.base}/maintenance/api/bumps/${encodeURIComponent(id)}`),
    );
  }

  private repositoryUrl(name: string): string {
    return `${this.base}/maintenance/api/repositories/${encodeURIComponent(name)}`;
  }
}
