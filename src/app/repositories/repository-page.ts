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
import { ActivatedRoute, convertToParamMap, RouterLink } from '@angular/router';
import { QitsButton, QitsCard } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import {
  changeCount,
  isBumpTerminal,
  type BumpDto,
  type GroupDto,
  type RepositoryDetailDto,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, describeError, failed, ready, statusOf, type Loadable } from '../ui/loadable';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/** How often this page re-reads while a bump for this repository is still going. */
export const POLL_INTERVAL_MS = 2000;

/** A group, with everything this page needs to draw its panel and its button. */
interface GroupPanel {
  readonly group: GroupDto;
  readonly busy: boolean;
  readonly activeBumpId: string | null;
}

/**
 * One repository: every pin its manifests hold, a panel per maintenance group, and what has been
 * bumped here lately.
 *
 * **Pending is the service's word, never a comparison made here.** Maven, npm and OCI tags order
 * differently, and a client that decided "2026.8.10 is behind 2026.8.9" would highlight rows the
 * service is not going to move. The `pending` flag on a pin is the same answer the bump uses.
 *
 * **The button is disabled while that group's bump is running, and still handles a 409.** The
 * disable is a courtesy — the reader can see the bump on screen — and the 409 is the truth: the
 * service holds the rule, and a bump started by the schedule a second before the click is a state
 * this page cannot have seen.
 */
@Component({
  selector: 'app-repository-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, QitsCard, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './repository-page.css'],
  templateUrl: './repository-page.html',
})
export class RepositoryPage {
  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly scheduler = inject(QITS_SCHEDULER);

  protected readonly none = NONE;
  private readonly now = tickingNow(30000);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  /** The repository this page is about, straight out of the URL. */
  protected readonly name = computed(() => this.params().get('name') ?? '');

  protected readonly detailState = signal<Loadable<RepositoryDetailDto>>(LOADING);
  protected readonly bumpsState = signal<Loadable<readonly BumpDto[]>>(LOADING);

  /** The group whose button is waiting for its 202, or nothing. */
  protected readonly bumping = signal<string | null>(null);
  /** What came of pressing a button when it was not simply accepted — a 409, or a failure. */
  protected readonly bumpNote = signal('');
  protected readonly pollProblem = signal('');

  private stopPolling: (() => void) | null = null;
  private inFlight = false;

  protected readonly detail = computed(() => {
    const state = this.detailState();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly pins = computed(() => this.detail()?.pins ?? []);

  protected readonly pendingPins = computed(() => this.pins().filter((pin) => pin.pending).length);

  protected readonly caption = computed(
    () => `${plural(this.pins().length, 'pin')}, ${this.pendingPins()} behind.`,
  );

  protected readonly bumps = computed(() => {
    const state = this.bumpsState();
    return state.kind === 'ready' ? state.value : [];
  });

  private readonly activeBumps = computed(() =>
    this.bumps().filter((bump) => !isBumpTerminal(bump.status)),
  );

  /** One panel per group, each knowing whether its own branch is being written right now. */
  protected readonly panels = computed<readonly GroupPanel[]>(() => {
    const active = new Map(this.activeBumps().map((bump) => [bump.group, bump.id]));
    const pressed = this.bumping();
    return (this.detail()?.groups ?? []).map((group) => ({
      group,
      busy: pressed === group.name || active.has(group.name),
      activeBumpId: active.get(group.name) ?? null,
    }));
  });

  constructor() {
    // The name comes from the URL, so a navigation between two repositories must throw away
    // everything the old one owned before the new reads land.
    effect(() => {
      const name = this.name();
      untracked(() => {
        this.reset();
        if (name) {
          void this.load();
        }
      });
    });

    inject(DestroyRef).onDestroy(() => this.stopPoll());
  }

  /** A listing row may arrive without its changes, so the count is read rather than assumed. */
  protected changes(bump: BumpDto): number {
    return changeCount(bump);
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  protected async load(): Promise<void> {
    await Promise.all([this.loadDetail(), this.loadBumps()]);
  }

  protected async loadDetail(): Promise<void> {
    const name = this.name();
    if (this.detailState().kind !== 'ready') {
      this.detailState.set(LOADING);
    }
    try {
      this.detailState.set(ready(await this.api.repository(name)));
    } catch (error) {
      this.detailState.set(failed(error));
    }
  }

  protected async loadBumps(): Promise<void> {
    const name = this.name();
    if (this.bumpsState().kind !== 'ready') {
      this.bumpsState.set(LOADING);
    }
    try {
      this.bumpsState.set(ready(await this.api.bumps(name)));
    } catch (error) {
      this.bumpsState.set(failed(error));
    }
    this.syncPolling();
  }

  /**
   * Create this group's branch now.
   *
   * A 409 means a bump for this repository and group is already active — the service's own rule,
   * the same one the schedule obeys. It is reported as a sentence and the lists are re-read, which
   * puts the active bump on screen.
   */
  protected async bump(group: string): Promise<void> {
    if (this.bumping()) {
      return;
    }
    this.bumping.set(group);
    this.bumpNote.set('');
    try {
      const accepted = await this.api.startBump(this.name(), group);
      this.bumpNote.set(`Bump ${accepted.id} accepted for ${group}.`);
    } catch (error) {
      this.bumpNote.set(
        statusOf(error) === 409
          ? `Not started: a bump is already running for ${group}. It is the one shown below.`
          : `Could not start a bump for ${group} — ${describeError(error)}.`,
      );
    } finally {
      this.bumping.set(null);
      await this.loadBumps();
    }
  }

  /** One poll: the bumps, and the repository beside them because a landed bump moves its branch. */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const [detail, bumps] = await Promise.all([
        this.api.repository(this.name()),
        this.api.bumps(this.name()),
      ]);
      this.detailState.set(ready(detail));
      this.bumpsState.set(ready(bumps));
      this.pollProblem.set('');
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.inFlight = false;
      this.syncPolling();
    }
  }

  private syncPolling(): void {
    if (this.activeBumps().length > 0) {
      this.stopPolling ??= this.scheduler.every(POLL_INTERVAL_MS, () => void this.poll());
    } else {
      this.stopPoll();
    }
  }

  private reset(): void {
    this.stopPoll();
    this.detailState.set(LOADING);
    this.bumpsState.set(LOADING);
    this.bumping.set(null);
    this.bumpNote.set('');
    this.pollProblem.set('');
  }

  private stopPoll(): void {
    this.stopPolling?.();
    this.stopPolling = null;
  }
}
