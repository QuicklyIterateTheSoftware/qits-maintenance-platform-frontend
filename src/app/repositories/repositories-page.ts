import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import {
  groupSection,
  isBumpTerminal,
  type BumpDto,
  type GroupDto,
  type InventorySection,
  type RepositoryDto,
  type ScanScope,
} from '../api/dto';
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

/** A repository as this listing draws it: only the groups of the section on screen. */
interface RepositoryRow {
  readonly repository: RepositoryDto;
  readonly groups: readonly GroupDto[];
  readonly pending: number;
}

/**
 * Every repository in the catalog, seen from one side of the inventory.
 *
 * **One component, two addresses.** `/internal` and `/external` are the same listing asked a
 * different question, and the section arrives as route `data` rather than as a parameter — see
 * app.routes.ts. Everything that differs follows from it: the heading, the one scan button, and
 * which of a repository's groups are drawn at all.
 *
 * **The section filters the groups, not the repositories.** A repository with nothing on this side
 * still has a row: it was scanned, its status is worth reading, and a listing that dropped it would
 * make "is this repository being maintained" unanswerable from the page that exists to answer it.
 * Its pending figure is the sum over the groups shown, which is the only figure the row's chips can
 * be checked against.
 *
 * **The header button starts real work.** `Scan internal` re-reads the manifests and the qits
 * registries; `Scan external` re-reads the mirror. It answers 202 and is queued on the service's
 * one worker, so pressing it twice queues two scans rather than interleaving them — and it is not
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
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly scheduler = inject(QITS_SCHEDULER);

  protected readonly none = NONE;
  /** The clock the relative times are drawn against — a minute's resolution needs no more. */
  private readonly now = tickingNow(30000);

  private readonly data = toSignal(this.route.data, {
    initialValue: {} as Record<string, unknown>,
  });

  /**
   * Which half of the inventory this listing is about, from the route table.
   *
   * INTERNAL is the fallback rather than an error: a route added without the datum should show the
   * platform's own side, which is the front door, instead of an empty page nobody can diagnose.
   */
  protected readonly section = computed<InventorySection>(() =>
    this.data()['section'] === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
  );

  /** `Internal` / `External`, for the heading and the button. */
  protected readonly sectionLabel = computed(() => label(this.section()));

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

  /**
   * The rows, each carrying only the groups of the section on screen.
   *
   * The per-repository figure is summed over those groups rather than taken from `pending`, which
   * counts both sides: a row saying "4 pending" beside chips adding up to one would be a page
   * arguing with itself.
   */
  protected readonly rows = computed<readonly RepositoryRow[]>(() => {
    const section = this.section();
    return this.repositories().map((repository) => {
      const groups = repository.groups.filter((group) => groupSection(group) === section);
      return {
        repository,
        groups,
        pending: groups.reduce((sum, group) => sum + group.pending, 0),
      };
    });
  });

  protected readonly caption = computed(() =>
    plural(this.rows().length, 'repository', 'repositories'),
  );

  /** How much of this side of the catalog is behind — the one number the page opens with. */
  protected readonly totalPending = computed(() =>
    this.rows().reduce((sum, row) => sum + row.pending, 0),
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
      const [repositories, bumps] = await Promise.all([this.api.repositories(), this.api.bumps()]);
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
