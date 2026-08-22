import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  AcceptedDto,
  BumpDto,
  DependencyDto,
  RepositoryDetailDto,
  RepositoryDto,
  ScanScope,
} from './dto';

/**
 * Everything this app says to qits-platform-maintenance, through the edge, at `/maintenance/api`.
 *
 * **Five reads and two writes, and the writes are the point of the application.** A scan refreshes
 * what the platform pins and what the registries hold; a bump asks CI to write the branch. Both
 * answer 202: the work is accepted, not finished, and every page re-reads for anything else.
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

  /** One repository with every pin its manifests hold. */
  repository(name: string): Promise<RepositoryDetailDto> {
    return firstValueFrom(this.http.get<RepositoryDetailDto>(this.repositoryUrl(name)));
  }

  /**
   * Who pins what, for dependency names matching a glob.
   *
   * The glob is the service's to interpret — `@qits/*`, `eu.wohlben.qits:qits-eventstream` — and is
   * sent as a query parameter rather than a path segment, because a name holds slashes and colons
   * and a reader types both.
   */
  dependencies(name: string): Promise<readonly DependencyDto[]> {
    return firstValueFrom(
      this.http.get<DependencyDto[]>(`${this.base}/maintenance/api/dependencies`, {
        params: new HttpParams().set('name', name),
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
