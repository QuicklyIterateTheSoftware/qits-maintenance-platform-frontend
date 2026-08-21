import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { isBumpTerminal, type BumpDto, type RepositoryDto, type ScanScope } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { GroupChips } from '../ui/group-chips';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/** How often this page re-reads while something it started is still going. */
export const POLL_INTERVAL_MS = 2000;

/**
 * How many polls a scan is followed for before the page stops waiting — three minutes.
 *
 * A scan has no address of its own in the contract (`POST /scans` answers an id, and there is no
 * `GET /scans/{id}`), so "it finished" can only be read off the rows it moves. A scan that moves
 * none of them — an EXTERNAL refresh that only touches latest versions — would otherwise be waited
 * on for ever, so the wait is bounded and says so when it gives up.
 */
export const SCAN_POLL_LIMIT = 90;

/**
 * The front door: every repository in the catalog, when it was last read, and what is waiting.
 *
 * **The two header buttons start real work.** `Scan internal` re-reads the manifests and the qits
 * registries; `Scan external` re-reads the mirror. Both answer 202 and are queued on the service's
 * one worker, so pressing one twice queues two scans rather than interleaving them — and neither is
 * greyed out while one is going, because the service holds that rule and this page reports its
 * answer rather than keeping a second copy of it.
 *
 * **The page polls while something is in flight and stops the moment nothing is.** In flight means
 * a bump that has not reached a terminal status, or a scan started here whose repository rows have
 * not moved yet. A terminal list is complete, and a further read could add nothing.
 *
 * **A failed poll leaves the last good listing on screen.** It is still the last thing the server
 * said, and blanking the table because one request out of a hundred timed out would lose more than
 * it tells.
 */
@Component({
  selector: 'app-repositories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, GroupChips, QitsButton, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './repositories-page.css'],
  templateUrl: './repositories-page.html',
})
export class RepositoriesPage {
  private readonly api = inject(MaintenanceApi);
  private readonly scheduler = inject(QITS_SCHEDULER);

  protected readonly none = NONE;
  /** The clock the relative times are drawn against — a minute's resolution needs no more. */
  private readonly now = tickingNow(30000);

  protected readonly reposState = signal<Loadable<readonly RepositoryDto[]>>(LOADING);
  protected readonly bumpsState = signal<Loadable<readonly BumpDto[]>>(LOADING);

  protected readonly scanning = signal(false);
  /** What came of pressing a scan button, and what became of the scan afterwards. */
  protected readonly scanNote = signal('');
  /** A poll that did not answer, reported beside the table rather than replacing it. */
  protected readonly pollProblem = signal('');

  /** Each repository's `lastScanAt` at the moment a scan was asked for, or nothing. */
  private scanBaseline: ReadonlyMap<string, string | null> | null = null;
  private scanPolls = 0;
  private stopPolling: (() => void) | null = null;
  private inFlight = false;

  protected readonly repositories = computed(() => {
    const state = this.reposState();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly bumps = computed(() => {
    const state = this.bumpsState();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly activeBumps = computed(() =>
    this.bumps().filter((bump) => !isBumpTerminal(bump.status)),
  );

  protected readonly caption = computed(() =>
    plural(this.repositories().length, 'repository', 'repositories'),
  );

  /** How many pins across the whole catalog are behind — the one number the page opens with. */
  protected readonly totalPending = computed(() =>
    this.repositories().reduce((sum, repository) => sum + repository.pending, 0),
  );

  constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => this.stopPoll());
  }

  /** Absolute, for a `title`: the relative form on screen is the one a reader reads. */
  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  /** The page's two reads, issued together and retried separately. */
  protected async load(): Promise<void> {
    await Promise.all([this.loadRepositories(), this.loadBumps()]);
  }

  protected async loadRepositories(): Promise<void> {
    if (this.reposState().kind !== 'ready') {
      this.reposState.set(LOADING);
    }
    try {
      this.reposState.set(ready(await this.api.repositories()));
    } catch (error) {
      this.reposState.set(failed(error));
    }
    this.settleScan();
    this.syncPolling();
  }

  protected async loadBumps(): Promise<void> {
    if (this.bumpsState().kind !== 'ready') {
      this.bumpsState.set(LOADING);
    }
    try {
      this.bumpsState.set(ready(await this.api.bumps()));
    } catch (error) {
      this.bumpsState.set(failed(error));
    }
    this.syncPolling();
  }

  /**
   * Ask for a scan.
   *
   * The baseline is taken before the request, so "the rows moved" is measured against the server's
   * own timestamps rather than against this browser's clock — the two disagree by seconds, and a
   * comparison to `Date.now()` would call a scan finished before it started.
   */
  protected async scan(scope: ScanScope): Promise<void> {
    if (this.scanning()) {
      return;
    }
    this.scanning.set(true);
    this.scanNote.set('');
    try {
      await this.api.startScan(scope);
      this.scanBaseline = new Map(
        this.repositories().map((repository) => [repository.name, repository.lastScanAt]),
      );
      this.scanPolls = 0;
      this.scanNote.set(`${label(scope)} scan accepted. This page follows it until the rows move.`);
      await this.load();
    } catch (error) {
      this.scanNote.set(`Could not start the scan — ${describeError(error)}.`);
    } finally {
      this.scanning.set(false);
      this.syncPolling();
    }
  }

  /** One poll: both lists, one request each, never two of the same in flight. */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    this.scanPolls += 1;
    try {
      const [repositories, bumps] = await Promise.all([
        this.api.repositories(),
        this.api.bumps(),
      ]);
      this.reposState.set(ready(repositories));
      this.bumpsState.set(ready(bumps));
      this.pollProblem.set('');
      this.settleScan();
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.inFlight = false;
      this.syncPolling();
    }
  }

  /** A scan is over for this page when every row it could have moved has moved — or when it waits no longer. */
  private settleScan(): void {
    const baseline = this.scanBaseline;
    if (!baseline) {
      return;
    }
    const moved = this.repositories().every(
      (repository) => baseline.get(repository.name) !== repository.lastScanAt,
    );
    if (moved && this.repositories().length > 0) {
      this.scanBaseline = null;
      this.scanNote.set('Scan finished. The rows below are what it found.');
      return;
    }
    if (this.scanPolls >= SCAN_POLL_LIMIT) {
      this.scanBaseline = null;
      this.scanNote.set(
        'The scan is taking longer than this page waits, or refreshed only the latest versions. Reload to see where it got to.',
      );
    }
  }

  private syncPolling(): void {
    if (this.activeBumps().length > 0 || this.scanBaseline !== null) {
      this.stopPolling ??= this.scheduler.every(POLL_INTERVAL_MS, () => void this.poll());
    } else {
      this.stopPoll();
    }
  }

  private stopPoll(): void {
    this.stopPolling?.();
    this.stopPolling = null;
  }
}

function label(scope: ScanScope): string {
  return scope.charAt(0) + scope.slice(1).toLowerCase();
}
