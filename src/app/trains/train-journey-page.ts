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
import { QitsAppLinks, QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import { isTrainSettled, trainEndNote, type TrainDto, type TrainNodeDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { QITS_SCHEDULER } from '../ui/scheduler';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * How often the journey is re-read while any train in it is still OPEN.
 *
 * Slower than the bump pages' two seconds, and deliberately: a train moves when a consumer's CI
 * lands a bump, which is minutes rather than seconds, and one poll here is one request per train
 * stitched. Five seconds is still faster than anybody can read a tree.
 */
export const POLL_INTERVAL_MS = 5000;

/**
 * How deep the stitching goes before it stops and hands the reader a link instead.
 *
 * Generous on purpose — the longest real chain on this platform is a library, a service, an image
 * and a deployment, four or five stations — so reaching this at all means something unexpected: a
 * chain nobody predicted, or a graph that loops through versions this page cannot tell apart. Both
 * are better answered with "it continues over here" than with a page that never finishes loading.
 */
export const MAX_DEPTH = 10;

/**
 * A station on the journey: one release, drawn as the header of the consumers beneath it.
 *
 * `depth` counts stations and not rows — 0 is the release the address names — and a node row
 * carries the depth of the station it belongs to, indented one step further by the stylesheet.
 */
interface StationRow {
  readonly kind: 'station';
  /** Path-derived, because one train can hang under two different nodes of the same journey. */
  readonly key: string;
  readonly depth: number;
  readonly train: TrainDto;
  readonly landed: number;
  /** `maven eu.wohlben.qits:qits-eventstream`, joined — what this release actually published. */
  readonly packages: string;
}

/** One consumer of the release above it, and whatever its own release started. */
interface NodeRow {
  readonly kind: 'node';
  readonly key: string;
  /** The station's depth, not one more: the indent for a node is the stylesheet's business. */
  readonly depth: number;
  readonly node: TrainNodeDto;
  readonly expanded: boolean;
  /** The train this consumer's own release opened, when this page has it. */
  readonly child: TrainDto | null;
  /** It opened one and this page is not drawing it — too deep, a loop, or a read that failed. */
  readonly continues: boolean;
}

type JourneyRow = StationRow | NodeRow;

/**
 * One release, and everything that happened downstream of it.
 *
 * <p><b>The journey is stitched here, not served.</b> qits-platform-maintenance answers one train at
 * a time: a release, and the consumers that were meant to take it. Each of those consumers, once it
 * releases in turn, opens a train of its own, and the `childTrainId` on the node is the link between
 * them. Following those links and merging the answers into one growing tree is this page's whole
 * job, and it is a frontend job on purpose — how far to follow is a question about a reading, and a
 * server that walked it would have to guess.
 *
 * <p><b>Breadth-first, bounded, and never the same train twice.</b> Every wave asks for the child
 * trains the loaded ones name and have not been asked for, so a diamond — two consumers releasing
 * something a third pins — costs one request and not two, and a loop costs none at all. The waves
 * stop at {@link MAX_DEPTH}; so does the drawing, and a node whose train is past either edge gets a
 * link to that train's own page rather than silence.
 *
 * <p><b>Collapsed is the state a reader arrives in.</b> The root release and everything that
 * consumes it are on screen at once, which is the first question; a subtree is a second question and
 * is opened one at a time — or all at once with the header button, which follows every train this
 * page has. A journey drawn fully open would bury the release it is about under three screens of
 * consumers.
 *
 * <p><b>Expanding a node shows what it did, and where the rest of the platform says the same
 * thing.</b> The detail panel carries the consumer, its archetype, what kind of end it is, the
 * version it adopted and when — and a links row: the in-app link to the consumer's repository page,
 * and the release request that carried the adoption, which lives in qits-projects.
 *
 * <p><b>The outbound anchors are addresses the platform states, never ones this build spells.</b>
 * `QitsAppLinks.href` answers `undefined` for an application this platform does not serve — and for
 * one whose navigation has not arrived yet — and the anchor is then not drawn at all. A row with a
 * link to nowhere is worse than a row without one. They are full-document hrefs on purpose: the
 * destination is a different Angular application, and a router link there would go nowhere.
 *
 * <p><b>It polls while any train on screen is OPEN, and stops the moment none is.</b> A COMPLETED
 * or SUPERSEDED train is finished — nothing will move in it again — so a journey made entirely of
 * those is read once. A failed poll leaves the last good tree on screen and says so above it.
 */
@Component({
  selector: 'app-train-journey-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './train-journey-page.css'],
  templateUrl: './train-journey-page.html',
})
export class TrainJourneyPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly scheduler = inject(QITS_SCHEDULER);
  private readonly appLinks = inject(QitsAppLinks);

  protected readonly none = NONE;
  /** The clock the relative times are drawn against. */
  private readonly now = tickingNow(30000);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  /** The train the address names, which is the root of the tree and nothing more. */
  protected readonly rootId = computed(() => this.params().get('id') ?? '');

  /** Whether the root arrived. The tree itself is read off `trains`, which grows after it. */
  protected readonly state = signal<Loadable<TrainDto>>(LOADING);

  /** Every train stitched so far, by id. One entry per train however many nodes point at it. */
  private readonly trains = signal<ReadonlyMap<string, TrainDto>>(new Map());

  /** Which subtrees are open, by row key. Never mutated in place — see `toggle`. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set<string>());

  /** A poll that did not answer, or a graft that partly failed, reported beside the tree. */
  protected readonly pollProblem = signal('');

  /** Ids this page has already asked for, so a loop and a diamond both cost one request. */
  private readonly attempted = new Set<string>();
  private stopPolling: (() => void) | null = null;
  private inFlight = false;

  protected readonly root = computed<TrainDto | null>(
    () => this.trains().get(this.rootId()) ?? null,
  );

  /** How many trains this page has merged, which is how far the journey reaches. */
  protected readonly stitched = computed(() => this.trains().size);

  /** Consumers across every stitched train, and how many of them have landed. */
  protected readonly reach = computed(() => {
    let consumers = 0;
    let landed = 0;
    for (const train of this.trains().values()) {
      for (const node of train.nodes) {
        consumers += 1;
        if (node.state === 'LANDED') {
          landed += 1;
        }
      }
    }
    return { consumers, landed };
  });

  protected readonly caption = computed(() => {
    const reach = this.reach();
    return (
      `${plural(this.stitched(), 'train')} stitched from this release, ` +
      `${plural(reach.consumers, 'consumer')}, ${reach.landed} landed.`
    );
  });

  /** Whether there is anything to follow at all — the header button is pointless otherwise. */
  protected readonly followable = computed(() =>
    Array.from(this.trains().values()).some((train) =>
      train.nodes.some((node) => !!node.childTrainId),
    ),
  );

  protected readonly rows = computed<readonly JourneyRow[]>(() => this.rowsFor(this.expanded()));

  /**
   * The release reached nobody. Read off the root's own nodes and not off `rows`, which always
   * holds at least the station — a table of one header row is not a table, it is blank space with
   * a border.
   */
  protected readonly reachedNothing = computed(() => this.root()?.nodes.length === 0);

  constructor() {
    effect(() => {
      const id = this.rootId();
      untracked(() => {
        this.stopPoll();
        this.pollProblem.set('');
        this.trains.set(new Map());
        this.expanded.set(new Set());
        this.attempted.clear();
        this.state.set(LOADING);
        if (id) {
          void this.load();
        }
      });
    });

    inject(DestroyRef).onDestroy(() => this.stopPoll());
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  protected note(endKind: string): string {
    return trainEndNote(endKind);
  }

  /** When this consumer last did anything: landing if it has, adopting if it has not. */
  protected moved(node: TrainNodeDto): string | null {
    return node.landedAt ?? node.adoptedAt;
  }

  /**
   * One release's own request in qits-projects — where the gates, the commits and the artifacts of
   * it are.
   *
   * <p><b>Addressed by CATALOG ID and version</b>, which is the coordinate that side's
   * `release-requests/by-release/:repoId/:version` resolver takes; the request's own id is minted
   * there and is not something a train carries. A row whose repository the inventory could not place
   * has no id and therefore no address, and gets no anchor.
   *
   * <p><b>The scope is the PROJECT alone.</b> qits-projects serves that resolver bare and under a
   * project slug and under no repository-scoped address, so spelling a group and a repository into
   * it would compose a URL that 404s.
   */
  protected requestHref(catalogId: string | null, version: string | null): string | undefined {
    if (!catalogId || !version) {
      return undefined;
    }
    return this.appLinks.href(
      'qits-projects',
      `release-requests/by-release/${encodeURIComponent(catalogId)}/` +
        `${encodeURIComponent(version)}`,
      { project: this.scoped.scope().project },
    );
  }

  /**
   * The release of the CONSUMER that took this version — the request the adoption rode in on.
   *
   * Only for a node that has adopted: a PENDING one names no version of its own, and the version
   * column of a train is exactly the consumer's own release, so before it there is nothing to open.
   */
  protected adoptionRequestHref(node: TrainNodeDto): string | undefined {
    if (node.state !== 'ADOPTED' && node.state !== 'LANDED') {
      return undefined;
    }
    return this.requestHref(node.consumerCatalogId, node.adoptedVersion);
  }

  /**
   * Open or close one subtree.
   *
   * A new `Set` rather than a mutation: the signal holds the set itself, and mutating it in place
   * would leave every computed above reading the same reference and never recomputing.
   */
  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.expanded.set(next);
  }

  /**
   * Open every node that has a train under it, however deep.
   *
   * Done by re-running the layout rather than by a second walk of the graph: each round opens the
   * child-bearing nodes that are visible now, which makes the next round's rows longer, and it
   * settles when a round adds nothing. Bounded by the same depth the stitching is.
   */
  protected followAll(): void {
    const keys = new Set(this.expanded());
    for (let round = 0; round <= MAX_DEPTH; round += 1) {
      const before = keys.size;
      for (const row of this.rowsFor(keys)) {
        if (row.kind === 'node' && row.child && !row.continues) {
          keys.add(row.key);
        }
      }
      if (keys.size === before) {
        break;
      }
    }
    this.expanded.set(new Set(keys));
  }

  protected collapseAll(): void {
    this.expanded.set(new Set());
  }

  /** The root, then everything the stitching found under it. Re-issued by the retry button. */
  protected async load(): Promise<void> {
    const id = this.rootId();
    if (this.state().kind !== 'ready') {
      this.state.set(LOADING);
    }
    this.attempted.clear();
    this.attempted.add(id);
    try {
      const root = await this.api.train(id);
      this.trains.set(new Map([[root.id, root]]));
      this.state.set(ready(root));
    } catch (error) {
      this.trains.set(new Map());
      this.state.set(failed(error));
      return;
    }
    await this.graft();
    this.syncPolling();
  }

  /**
   * Breadth-first, one wave per level, never asking for a train this page has already asked for.
   *
   * A wave that partly fails keeps what answered: a journey missing one branch is worth more than
   * an error page, and the branch that failed is drawn as one that continues elsewhere.
   */
  private async graft(): Promise<void> {
    for (let wave = 0; wave < MAX_DEPTH; wave += 1) {
      const wanted = this.unstitched();
      if (wanted.length === 0) {
        return;
      }
      for (const id of wanted) {
        this.attempted.add(id);
      }
      const answers = await Promise.allSettled(wanted.map((id) => this.api.train(id)));
      const next = new Map(this.trains());
      let problem = '';
      for (const answer of answers) {
        if (answer.status === 'fulfilled') {
          next.set(answer.value.id, answer.value);
        } else {
          problem = describeError(answer.reason);
        }
      }
      this.trains.set(next);
      this.pollProblem.set(problem);
    }
  }

  /** Child trains the loaded ones name that this page has neither got nor asked for. */
  private unstitched(): readonly string[] {
    const loaded = this.trains();
    const wanted = new Set<string>();
    for (const train of loaded.values()) {
      for (const node of train.nodes) {
        if (
          node.childTrainId &&
          !loaded.has(node.childTrainId) &&
          !this.attempted.has(node.childTrainId)
        ) {
          wanted.add(node.childTrainId);
        }
      }
    }
    return Array.from(wanted);
  }

  /**
   * One poll: every train on screen, re-read, and then whatever that revealed.
   *
   * All of them and not only the OPEN ones, because a node that adopted since the last read names a
   * child train that did not exist before — and that child is grafted in the same pass.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const ids = Array.from(this.trains().keys());
      const answers = await Promise.all(ids.map((id) => this.api.train(id)));
      this.trains.set(new Map(answers.map((train) => [train.id, train])));
      const root = this.root();
      if (root) {
        this.state.set(ready(root));
      }
      this.pollProblem.set('');
      await this.graft();
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.inFlight = false;
      this.syncPolling();
    }
  }

  /** Poll while anything on screen can still move, and stop for good when nothing can. */
  private syncPolling(): void {
    const open = Array.from(this.trains().values()).some((train) => !isTrainSettled(train.status));
    if (open) {
      this.stopPolling ??= this.scheduler.every(POLL_INTERVAL_MS, () => void this.poll());
    } else {
      this.stopPoll();
    }
  }

  private stopPoll(): void {
    this.stopPolling?.();
    this.stopPolling = null;
  }

  /**
   * The tree flattened into rows, for a given set of open subtrees.
   *
   * A pure function of the loaded trains and that set, which is what lets `followAll` run it a few
   * times over sets of its own rather than walk the graph a second way.
   *
   * The `path` is the cycle guard the DRAWING needs, and it is not the same one the fetching has: a
   * train can honestly appear twice in one journey (two consumers releasing something a third
   * pins), and that must draw twice — but a train appearing under itself is a loop, and would draw
   * for ever.
   */
  private rowsFor(expanded: ReadonlySet<string>): readonly JourneyRow[] {
    const trains = this.trains();
    const root = trains.get(this.rootId());
    if (!root) {
      return [];
    }
    const rows: JourneyRow[] = [];

    const walk = (train: TrainDto, depth: number, ancestors: readonly string[], prefix: string) => {
      const path = [...ancestors, train.id];
      rows.push({
        kind: 'station',
        key: `${prefix}${train.id}`,
        depth,
        train,
        landed: train.nodes.filter((node) => node.state === 'LANDED').length,
        packages: train.packages.map((held) => `${held.ecosystem} ${held.name}`).join(', '),
      });
      for (const node of train.nodes) {
        const key = `${prefix}${train.id}/${node.id}`;
        const childId = node.childTrainId;
        const child = childId ? (trains.get(childId) ?? null) : null;
        const blocked = !!childId && (depth + 1 > MAX_DEPTH || path.includes(childId));
        const isExpanded = expanded.has(key);
        rows.push({
          kind: 'node',
          key,
          depth,
          node,
          expanded: isExpanded,
          child,
          continues: !!childId && (!child || blocked),
        });
        if (isExpanded && child && !blocked) {
          walk(child, depth + 1, path, `${key}/`);
        }
      }
    };

    walk(root, 0, [], '');
    return rows;
  }
}
