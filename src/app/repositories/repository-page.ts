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
import { injectScopedProject } from '../nav/scoped-project';
import {
  changeCount,
  isBumpTerminal,
  releaseSentinel,
  type BumpDto,
  type DownstreamDto,
  type DownstreamEntryDto,
  type GroupDto,
  type PinDto,
  type RepositoryDependentsDto,
  type RepositoryDetailDto,
  type TransitiveDto,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, describeError, failed, ready, statusOf, type Loadable } from '../ui/loadable';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';
import { DependentsTable } from './dependents-table';
import { DownstreamTable } from './downstream-table';
import { PinsTable } from './pins-table';

/** How often this page re-reads while a bump for this repository is still going. */
export const POLL_INTERVAL_MS = 2000;

/** A group, with everything this page needs to draw its panel and its button. */
interface GroupPanel {
  readonly group: GroupDto;
  readonly busy: boolean;
  readonly activeBumpId: string | null;
}

/**
 * One repository, in both directions: what it pins, what its releases contain, what consumes them,
 * a panel per maintenance group, and what has been bumped here lately.
 *
 * **Pending is the service's word, never a comparison made here.** Maven, npm and OCI tags order
 * differently, and a client that decided "2026.8.10 is behind 2026.8.9" would highlight rows the
 * service is not going to move. The `pending` flag on a pin is the same answer the bump uses.
 *
 * **The pins are split by kind, because they are read for different reasons.** Internal is release
 * work — something of ours moved and this has not followed. External is patching. And REACTOR and
 * UNRESOLVED pins are neither: a module of the repository's own build has no registry to be behind,
 * and a coordinate nothing could place cannot be checked at all. They are real pins and they are
 * kept, but behind a disclosure, because a reader working through what is behind can do nothing
 * about either.
 *
 * **The dependents are not polled and have no button.** They are read off the bills of materials of
 * what has actually been released; a release is a fact that happened, and it does not move while it
 * is being looked at.
 *
 * **Downstream is the dependents followed to the end.** Dependents says who consumes this
 * repository; downstream says who consumes them as well, and how far the chain goes — which is what
 * a release of this repository is going to reach. It is traced by the service per request and, like
 * the dependents, read once and retried by hand rather than polled: a bump moves pins, and the
 * closure it might move is a question for the next visit rather than for the next two seconds.
 *
 * **The button is disabled while that group's bump is running, and still handles a 409.** The
 * disable is a courtesy — the reader can see the bump on screen — and the 409 is the truth: the
 * service holds the rule, and a bump started by the schedule a second before the click is a state
 * this page cannot have seen.
 */
@Component({
  selector: 'app-repository-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Async,
    DependentsTable,
    DownstreamTable,
    Empty,
    PinsTable,
    QitsButton,
    QitsCard,
    RouterLink,
    StatusBadge,
  ],
  styleUrls: ['../ui/page.css', './repository-page.css'],
  templateUrl: './repository-page.html',
})
export class RepositoryPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly scheduler = inject(QITS_SCHEDULER);

  protected readonly none = NONE;
  /** The clock the relative times are drawn against, shared with the dependents table. */
  protected readonly now = tickingNow(30000);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  /** The repository this page is about, straight out of the URL. */
  protected readonly name = computed(() => this.params().get('name') ?? '');

  protected readonly detailState = signal<Loadable<RepositoryDetailDto>>(LOADING);
  protected readonly bumpsState = signal<Loadable<readonly BumpDto[]>>(LOADING);
  protected readonly dependentsState = signal<Loadable<RepositoryDependentsDto>>(LOADING);
  protected readonly downstreamState = signal<Loadable<DownstreamDto>>(LOADING);

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

  protected readonly pins = computed<readonly PinDto[]>(() => this.detail()?.pins ?? []);

  /** What the repository's own releases contain. Absent from an older service, and then empty. */
  private readonly transitives = computed<readonly TransitiveDto[]>(
    () => this.detail()?.transitives ?? [],
  );

  protected readonly internalPins = computed(() =>
    this.pins().filter((pin) => pin.kind === 'INTERNAL'),
  );

  protected readonly externalPins = computed(() =>
    this.pins().filter((pin) => pin.kind === 'EXTERNAL'),
  );

  /**
   * The pins neither table claims: a module of the repository's own build, a coordinate nothing
   * resolved, and any kind a later service grows. Kept — they are pins a manifest really holds —
   * but out of the way, because nothing is ever going to move them.
   */
  protected readonly otherPins = computed(() =>
    this.pins().filter((pin) => pin.kind !== 'INTERNAL' && pin.kind !== 'EXTERNAL'),
  );

  protected readonly internalTransitives = computed(() =>
    this.transitivesUnder(this.internalPins()),
  );

  protected readonly externalTransitives = computed(() =>
    this.transitivesUnder(this.externalPins()),
  );

  protected readonly otherTransitives = computed(() => this.transitivesUnder(this.otherPins()));

  /**
   * Everything no pin on this page accounts for — an artifact's own root, and a `via` naming a
   * component this repository does not declare — handed to the internal table, which renders it
   * under its "(root)" disclosure.
   *
   * It goes there rather than to a fourth section because it is the repository's own artifacts that
   * contain it, and the internal table is where the repository's own side of the picture is. What
   * matters is that it is on the page at all: an unattributed component is the one an advisory is
   * most likely to name.
   */
  protected readonly rootTransitives = computed(() => {
    const declared = new Set(this.pins().map((pin) => pin.name));
    return this.transitives().filter(
      (transitive) => !transitive.via || !declared.has(transitive.via),
    );
  });

  /** The internal table's share: what hangs under an internal pin, plus everything unattributed. */
  protected readonly internalTransitivesWithRoots = computed(() => [
    ...this.internalTransitives(),
    ...this.rootTransitives(),
  ]);

  /**
   * Whether the tables have anything at all to say.
   *
   * A repository can have released artifacts and no readable manifest — an image built from a
   * Containerfile, a scan that could not check the tree out — and what those artifacts contain is
   * still worth drawing. "No pins were read here" is only the honest answer when there is nothing
   * on either side.
   */
  protected readonly hasPinContent = computed(
    () => this.pins().length > 0 || this.rootTransitives().length > 0,
  );

  protected readonly pendingPins = computed(() => this.pins().filter((pin) => pin.pending).length);

  protected readonly caption = computed(
    () => `${plural(this.pins().length, 'pin')}, ${this.pendingPins()} behind.`,
  );

  /**
   * The dependents grouped per artifact this repository publishes — one table each, because the
   * up-to-date verdict compares against THAT artifact's latest and a flattened list would have to
   * answer with one latest for several subjects.
   */
  protected readonly dependentGroups = computed(() => {
    const state = this.dependentsState();
    return state.kind === 'ready'
      ? (state.value.artifacts ?? []).filter((artifact) => (artifact.dependents ?? []).length > 0)
      : [];
  });

  /**
   * Everything the service traced downstream of this repository, in its own order — nearest first.
   *
   * Not re-sorted and not filtered here: the wrapper and this repository itself are excluded by the
   * service, and a client that dropped a row after the fact would still have paid for it.
   */
  protected readonly downstream = computed<readonly DownstreamEntryDto[]>(() => {
    const state = this.downstreamState();
    return state.kind === 'ready' ? state.value.downstream : [];
  });

  /** How far the chain goes — the furthest distance any row on it is at. */
  protected readonly downstreamCaption = computed(() => {
    const rows = this.downstream();
    const deepest = rows.reduce((far, row) => Math.max(far, row.depth), 0);
    return (
      `${plural(rows.length, 'repository', 'repositories')} downstream, ` +
      `${plural(deepest, 'hop')} at the furthest.`
    );
  });

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

  /** What a bump's `releaseRequestId` means when it is not an id, or null when it is one. */
  protected sentinel(bump: BumpDto): string | null {
    return releaseSentinel(bump.releaseRequestId);
  }

  /** The transitives that hang under one of these pins, by the name their `via` gives. */
  private transitivesUnder(pins: readonly PinDto[]): readonly TransitiveDto[] {
    const names = new Set(pins.map((pin) => pin.name));
    return this.transitives().filter((transitive) => !!transitive.via && names.has(transitive.via));
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  /** The page's four reads, issued together and retried separately. */
  protected async load(): Promise<void> {
    await Promise.all([
      this.loadDetail(),
      this.loadBumps(),
      this.loadDependents(),
      this.loadDownstream(),
    ]);
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
   * Who consumes this repository's artifacts.
   *
   * Never polled and never re-read by the poll below: a bump moves pins, and nothing a bump does
   * changes what has already been released and ingested. It is loaded once and retried by hand.
   */
  protected async loadDependents(): Promise<void> {
    const name = this.name();
    if (this.dependentsState().kind !== 'ready') {
      this.dependentsState.set(LOADING);
    }
    try {
      this.dependentsState.set(ready(await this.api.repositoryDependents(name)));
    } catch (error) {
      this.dependentsState.set(failed(error));
    }
  }

  /**
   * Everything downstream of this repository, however far the chain goes.
   *
   * Never polled, for the reason `loadDependents` gives and one of its own: this is a traced query
   * over the whole graph rather than a row fetch, and re-issuing it every two seconds while a bump
   * runs would be the most expensive read on the page repeated for a picture that does not move
   * while a branch is being written.
   */
  protected async loadDownstream(): Promise<void> {
    const name = this.name();
    if (this.downstreamState().kind !== 'ready') {
      this.downstreamState.set(LOADING);
    }
    try {
      this.downstreamState.set(ready(await this.api.downstream(name)));
    } catch (error) {
      this.downstreamState.set(failed(error));
    }
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
    this.dependentsState.set(LOADING);
    this.downstreamState.set(LOADING);
    this.bumping.set(null);
    this.bumpNote.set('');
    this.pollProblem.set('');
  }

  private stopPoll(): void {
    this.stopPolling?.();
    this.stopPolling = null;
  }
}
