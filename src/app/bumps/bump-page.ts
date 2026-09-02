import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import { bumpBranch, isBumpTerminal, releaseSentinel, type BumpDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatDuration, formatInstant, plural } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/** How often a bump that has not finished is re-read. */
export const POLL_INTERVAL_MS = 2000;

/**
 * One bump: the branch it was asked to write, the changes it sent, and the CI run that applied
 * them.
 *
 * **A bump is addressed by its id alone.** It belongs to a repository and a group, but a reader
 * arriving from a CI run or a chat message has the id and nothing else — so that is the whole path.
 *
 * **The changes are the contract, drawn as the service sent them.** Each line names the manifest,
 * the dependency, the two versions and the `location` the CI step edits — `property:…`,
 * `dependency:g:a`, `line:3`. When a bump goes wrong that column is usually the reason, so it is on
 * screen rather than in a log.
 *
 * **The CI run is a link out of this application.** qits-ci serves its own SPA at `/ci/`, and
 * `/ci/runs/<id>` is a run there — a plain href, because a router link only moves within this app.
 */
@Component({
  selector: 'app-bump-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './bump-page.css'],
  templateUrl: './bump-page.html',
})
export class BumpPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly scheduler = inject(QITS_SCHEDULER);

  protected readonly none = NONE;
  /** A running bump's elapsed time is a subtraction, never a reason to make a request. */
  private readonly now = tickingNow(1000);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  protected readonly id = computed(() => this.params().get('id') ?? '');

  protected readonly state = signal<Loadable<BumpDto>>(LOADING);
  protected readonly pollProblem = signal('');

  private stopPolling: (() => void) | null = null;
  private inFlight = false;

  protected readonly bump = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly branch = computed(() => {
    const bump = this.bump();
    return bump ? bumpBranch(bump) : '';
  });

  protected readonly changes = computed(() => this.bump()?.changes ?? []);

  protected readonly caption = computed(() => plural(this.changes().length, 'change'));

  /** How long it took, or how long it has been going. */
  protected readonly duration = computed(() => {
    const bump = this.bump();
    return bump ? formatDuration(bump.startedAt, bump.finishedAt, this.now()) : NONE;
  });

  /**
   * What the release door's answer means, when it is not a request id.
   *
   * A bump does not end at the branch: the branch is offered to qits-workspaces' release door, and
   * what that answered is on the row. Two of its answers are words rather than ids — the branch was
   * already integrated, or the door refused — and neither of them is something to link to.
   */
  protected readonly sentinel = computed(() => releaseSentinel(this.bump()?.releaseRequestId));

  /** The run in qits-ci's own frontend, which is another application at another base path. */
  protected readonly ciRunHref = computed(() => {
    const runId = this.bump()?.ciRunId;
    return runId ? `/ci/runs/${encodeURIComponent(runId)}` : null;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.stopPoll();
        this.pollProblem.set('');
        this.state.set(LOADING);
        if (id) {
          this.load();
        }
      });
    });

    inject(DestroyRef).onDestroy(() => this.stopPoll());
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  /** The page's one read, re-issued by the retry button and by the poll. */
  protected load(): void {
    this.api.bump(this.id()).then(
      (bump) => {
        this.state.set(ready(bump));
        this.syncPolling();
      },
      (error: unknown) => this.state.set(failed(error)),
    );
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      this.state.set(ready(await this.api.bump(this.id())));
      this.pollProblem.set('');
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.inFlight = false;
      this.syncPolling();
    }
  }

  /**
   * Poll while the bump has not finished, and stop for good when it has. A terminal bump is
   * complete — its changes and its run id are written — so a further read could add nothing.
   */
  private syncPolling(): void {
    const bump = this.bump();
    if (bump && !isBumpTerminal(bump.status)) {
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
