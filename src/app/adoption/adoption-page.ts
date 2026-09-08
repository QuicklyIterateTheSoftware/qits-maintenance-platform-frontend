import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import type { AdopterDto, AdoptionJourneyDto, AdoptionState } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * The geometry of the flowchart, in pixels, decided here and nowhere else.
 *
 * The layout is arithmetic rather than measurement, and that is a deliberate constraint: the only
 * other way to draw an edge between two cards is to render them, measure them with
 * `getBoundingClientRect`, and then draw — which is a second layout pass, a resize listener, and a
 * number that reads as zero under jsdom, where every spec in this repository runs. Fixed cards mean
 * every coordinate on this page is known before the first paint, an edge's `d` is a pure function of
 * two integers, and a spec can assert where a card landed without a browser.
 *
 * The cost is a card that cannot grow to fit its content, which is why names ellipsis with their
 * full text in a `title`. That is the right trade for this page: a repository name is long but a
 * reader recognises it from its head, and a column of cards that were all different heights would
 * make the edges between them harder to follow, not easier.
 */
const CARD_WIDTH = 240;
const CARD_HEIGHT = 116;

/** The space between two columns — the width every edge has to make its turn in. */
const COLUMN_GAP = 84;

const ROW_GAP = 16;

/** The band above the cards that the per-column header sits in. */
const HEADER_HEIGHT = 46;

/** One column of the flowchart: everything at one distance from the release. */
interface ChartColumn {
  readonly key: string;
  readonly depth: number;
  readonly x: number;
  /** How far away this column is, in words. */
  readonly label: string;
  /** The old depth header's count, kept: how much of this column is carrying the release. */
  readonly summary: string;
}

/** One card: the release itself, or one repository downstream of it. */
interface ChartNode {
  readonly key: string;
  readonly repository: string;
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  /** The subject of the page rather than an adopter of it — drawn once, in column zero. */
  readonly root: boolean;
  /** Whether there is a repository page to link to — see `AdopterDto.repositoryStatus`. */
  readonly linkable: boolean;
  readonly absent: boolean;
  readonly archetype: string;
  /** The adoption verdict, or null on the root card, which is the release and not an adopter. */
  readonly state: AdoptionState | null;
  readonly adopted: boolean;
  /** The release this card is about: the subject on the root, the adopting one on an adopter. */
  readonly version: string;
  /** What the card says about itself beyond its verdict — a wait, or nothing. */
  readonly note: string;
  readonly adoptedAt: string | null;
  /**
   * The cards that have an edge into this one, joined.
   *
   * Drawn for a screen reader only. The edges say this to the eye, and saying it twice on screen is
   * the sentence this redesign removed; but an edge is a `<path>` and reads as nothing at all
   * without sight, so the same fact is written out where only a reader who needs it will meet it.
   */
  readonly reachedFrom: string;
}

/** One edge, already resolved to the two cards it joins and the curve between them. */
interface ChartEdge {
  readonly key: string;
  /** The repository at the tail and at the head — also on the `<path>`, so the SVG is debuggable. */
  readonly from: string;
  readonly to: string;
  readonly path: string;
  /** Whether the card this edge arrives at is carrying the release. */
  readonly adopted: boolean;
}

/** The whole drawing, and the box it needs. */
interface Chart {
  readonly columns: readonly ChartColumn[];
  readonly nodes: readonly ChartNode[];
  readonly edges: readonly ChartEdge[];
  readonly width: number;
  readonly height: number;
}

const EMPTY_CHART: Chart = { columns: [], nodes: [], edges: [], width: 0, height: 0 };

/** Where a column's left edge sits. */
function columnX(column: number): number {
  return column * (CARD_WIDTH + COLUMN_GAP);
}

/** Where a row's top edge sits, under the band the column headers occupy. */
function rowY(row: number): number {
  return HEADER_HEIGHT + row * (CARD_HEIGHT + ROW_GAP);
}

/**
 * A cubic from one card's right edge to another card's left edge.
 *
 * The control points sit half the horizontal distance out from each end, so the curve leaves and
 * arrives horizontally and the reader's eye is never asked which end of a diagonal it is looking at.
 * The floor under that half matters for the edge that has to climb several rows inside one column
 * gap: without it the two control points collapse onto their anchors and the curve becomes a
 * straight line pointing off in a direction the layout does not mean.
 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = Math.max(28, Math.round((x2 - x1) / 2));
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
}

/**
 * One release, and how far it has travelled — drawn left to right as the graph it actually is.
 *
 * <p><b>The journey is served, not stitched.</b> qits-platform-maintenance traces the closure of
 * everything downstream of this release and evaluates the adoption of every step of it per request,
 * so this page makes ONE call and draws its answer. The release trains this replaced worked the
 * other way — the service stored one train per release and the client walked a train per consumer,
 * ten levels deep — and that walk is gone with them: a client that stitched a graph was deciding
 * how far the answer went, which is the service's question and not a reading's.
 *
 * <p><b>The address is the release itself.</b> `adoption/<repository>/<version>` is composed by
 * anything that has a release in its hand — a release request in qits-projects, a CI run, a chat
 * message — and needs nothing looked up first. It is also where `trains/by-release/…` now redirects,
 * so the links published while the trains existed still open the journey they meant.
 *
 * <p><b>A DAG, and not a tree.</b> This page used to be a table grouped by hop depth, and a table
 * cannot say the one thing the answer is actually shaped like: two upstreams can both lead to the
 * same repository — a service that pins a library directly AND submodules a frontend carrying it —
 * and `AdoptionEvaluator` decides such a repository ONCE, from whichever path got there first. So
 * the drawing merges too: one card per repository, with an edge in from every parent. Drawing a
 * tree instead would have to copy that repository under each parent, and the copies would then
 * disagree with each other about nothing — same verdict, same version, same timestamp — while
 * suggesting the release arrives there twice.
 *
 * <p><b>Left to right, one column per hop.</b> Column zero is the release; column n holds the
 * repositories n hops from it. Distance was a sentence in a group header before, which meant the
 * reader had to hold "two hops through what?" in their head while reading rows that never said. A
 * column position says the distance without a word, and an edge says the "through what".
 *
 * <p><b>The rows in a column are ordered here, and this is the one place in this application that
 * re-orders what the service sent.</b> Every listing here draws the service's order because a
 * client that sorted rows would disagree with its own caption; a flowchart has no such freedom —
 * name order would cross edges over each other for no reason a reader could see. So a card sits at
 * the mean row of its parents, ties broken by name, which pulls each card level with what feeds it
 * and leaves the ordering a pure function of the answer rather than of the order it arrived in.
 * Nothing beyond "depth ascending" is assumed of the service, and a depth-1 card's only parent is
 * the release, so that column falls back to name order exactly as before.
 *
 * <p><b>The via-chain sentence is gone.</b> A pending row used to read "waiting behind a → b", which
 * misread `via` as the path taken to get here; `via` is the set of ALL parents one hop nearer the
 * release, so the arrow was inventing an order between two repositories that are siblings. The
 * edges now carry that fact in the only form it is true in — several arrows into one card — and a
 * deep pending card says nothing more than that it is waiting.
 *
 * <p><b>Two states, and PENDING is not a failure.</b> An adopted card names which of that
 * repository's own releases first carried a new-enough copy, and when. A pending one is quiet: it
 * is the ordinary state of a downstream repository an hour after a release, and a page that drew
 * most of the estate as work would be wrong most of the time.
 *
 * <p><b>Nothing polls.</b> A pending card moves when a downstream repository releases, which is
 * minutes at best, and a re-read is one traced query over the whole graph rather than a cheap row
 * fetch. The header carries a button that asks again, which is the honest offer: this is a question
 * with an answer as of now, and the reader decides when to ask it a second time.
 */
@Component({
  selector: 'app-adoption-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './adoption-page.css'],
  templateUrl: './adoption-page.html',
})
export class AdoptionPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly none = NONE;

  /** The card box, handed to the stylesheet so the arithmetic above has exactly one source. */
  protected readonly cardWidth = `${CARD_WIDTH}px`;
  protected readonly cardHeight = `${CARD_HEIGHT}px`;

  /** The clock the relative times are drawn against — a minute's resolution needs no more. */
  private readonly now = tickingNow(30000);

  private readonly params = toSignal(this.route.paramMap, { initialValue: convertToParamMap({}) });

  /** The release this page is about, both halves of it, straight out of the URL. */
  protected readonly repository = computed(() => this.params().get('repository') ?? '');
  protected readonly version = computed(() => this.params().get('version') ?? '');

  protected readonly state = signal<Loadable<AdoptionJourneyDto>>(LOADING);

  /** Whether a re-read is in flight, so the button says so and cannot be pressed twice. */
  protected readonly rereading = signal(false);

  protected readonly journey = computed<AdoptionJourneyDto | null>(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : null;
  });

  protected readonly adopters = computed<readonly AdopterDto[]>(
    () => this.journey()?.adopters ?? [],
  );

  /** `maven eu.wohlben.qits:qits-eventstream`, joined — what this release actually published. */
  protected readonly packages = computed(() =>
    (this.journey()?.packages ?? []).map((held) => `${held.ecosystem} ${held.name}`).join(', '),
  );

  /**
   * The release is one this service holds no bill of materials for.
   *
   * Not an error and not a 404: the closure is a fact about the dependency graph and is answered
   * for any pair. But with nothing known to have been published, no downstream card can ever match,
   * and a chart of PENDING cards with no explanation would read as a platform that had stopped.
   */
  protected readonly nothingPublished = computed(
    () => !!this.journey() && this.packages().length === 0,
  );

  protected readonly adoptedCount = computed(
    () => this.adopters().filter((adopter) => adopter.state === 'ADOPTED').length,
  );

  protected readonly caption = computed(
    () =>
      `${plural(this.adopters().length, 'repository', 'repositories')} downstream of this release, ` +
      `${this.adoptedCount()} carrying it.`,
  );

  /** The release reached nobody — read off the adopters, not off the chart, which holds the root. */
  protected readonly reachedNothing = computed(() => this.adopters().length === 0);

  /**
   * The flowchart: cards placed on a grid of hops, and the curves between them.
   *
   * <p>Three passes, each with one job. The first merges the answer into one card per repository
   * and gives each of them a column and a row; the second resolves every parent name to a card that
   * was actually drawn and turns each surviving pair into a curve; the third writes the cards out
   * with the list of what arrives at them, which only the second pass knows.
   *
   * <p><b>Every lookup is by name, and a name that resolves to nothing is dropped.</b> The service
   * guarantees `via` names repositories it also lists, but a truncated closure — `DownstreamResolver`
   * bounds both depth and breadth and says so in a WARN rather than by failing — can hand this page
   * a parent it never sent. An edge to a card that is not there would be a curve into empty space,
   * so it is not drawn; the card at its head still is, because a repository that is downstream is
   * downstream whether or not this answer can say through what.
   */
  protected readonly chart = computed<Chart>(() => {
    const adopters = this.adopters();
    if (adopters.length === 0) {
      return EMPTY_CHART;
    }
    const rootName = this.journey()?.repository || this.repository();

    // ONE CARD PER REPOSITORY. The service already answers one entry per repository, so this is a
    // guard rather than a fold — but a duplicate would put two cards under one name, and the second
    // of them would collect the edges the first had already claimed.
    const byDepth = new Map<number, AdopterDto[]>();
    const claimed = new Set<string>([rootName]);
    for (const adopter of adopters) {
      if (!adopter.repository || claimed.has(adopter.repository)) {
        continue;
      }
      claimed.add(adopter.repository);
      // A depth the service never sends — zero, or negative — would land a card on top of the
      // release itself, which is the one column that is not an adopter's.
      const depth = Math.max(1, adopter.depth);
      const at = byDepth.get(depth);
      if (at) {
        at.push(adopter);
      } else {
        byDepth.set(depth, [adopter]);
      }
    }

    const depths = Array.from(byDepth.keys()).sort((left, right) => left - right);

    const rowOf = new Map<string, number>([[rootName, 0]]);
    const columnOf = new Map<string, number>([[rootName, 0]]);
    const placed: {
      readonly adopter: AdopterDto;
      readonly column: number;
      readonly row: number;
    }[] = [];
    const columns: ChartColumn[] = [
      { key: 'depth-0', depth: 0, x: columnX(0), label: this.depthLabel(0), summary: '' },
    ];

    depths.forEach((depth, index) => {
      const column = index + 1;
      const at = byDepth.get(depth) ?? [];
      const ordered = at
        .map((adopter) => ({ adopter, order: this.orderOf(adopter, rowOf) }))
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.adopter.repository.localeCompare(right.adopter.repository),
        );
      ordered.forEach(({ adopter }, row) => {
        rowOf.set(adopter.repository, row);
        columnOf.set(adopter.repository, column);
        placed.push({ adopter, column, row });
      });
      columns.push({
        key: `depth-${depth}`,
        depth,
        x: columnX(column),
        label: this.depthLabel(depth),
        summary: `${at.filter((adopter) => adopter.state === 'ADOPTED').length}/${at.length} carrying it`,
      });
    });

    const edges: ChartEdge[] = [];
    const parentsOf = new Map<string, string[]>();
    for (const { adopter, column, row } of placed) {
      const parents: string[] = [];
      // A depth-1 card hangs off the release whatever `via` says. The service does name the root
      // there, but the fallback costs nothing and the alternative is a first column of orphans.
      const candidates = adopter.depth <= 1 ? [rootName, ...adopter.via] : adopter.via;
      for (const parent of candidates) {
        const parentColumn = columnOf.get(parent);
        if (
          parentColumn === undefined ||
          parent === adopter.repository ||
          parents.includes(parent)
        ) {
          continue;
        }
        parents.push(parent);
        edges.push({
          key: `${parent}->${adopter.repository}`,
          from: parent,
          to: adopter.repository,
          path: edgePath(
            columnX(parentColumn) + CARD_WIDTH,
            rowY(rowOf.get(parent) ?? 0) + CARD_HEIGHT / 2,
            columnX(column),
            rowY(row) + CARD_HEIGHT / 2,
          ),
          adopted: adopter.state === 'ADOPTED',
        });
      }
      parentsOf.set(adopter.repository, parents);
    }

    const nodes: ChartNode[] = [
      {
        key: `0|${rootName}`,
        repository: rootName,
        column: 0,
        row: 0,
        x: columnX(0),
        y: rowY(0),
        root: true,
        linkable: true,
        absent: false,
        archetype: '',
        state: null,
        adopted: false,
        version: this.journey()?.version || this.version(),
        note: '',
        adoptedAt: null,
        reachedFrom: '',
      },
      ...placed.map(({ adopter, column, row }) => ({
        key: `${column}|${adopter.repository}`,
        repository: adopter.repository,
        column,
        row,
        x: columnX(column),
        y: rowY(row),
        root: false,
        linkable: !!adopter.repositoryStatus,
        absent: adopter.repositoryStatus === 'ABSENT',
        archetype: adopter.archetype || NONE,
        state: adopter.state,
        adopted: adopter.state === 'ADOPTED',
        version: adopter.adoptedVersion ?? NONE,
        note: this.noteFor(adopter),
        adoptedAt: adopter.adoptedAt,
        reachedFrom: (parentsOf.get(adopter.repository) ?? []).join(', '),
      })),
    ];

    // The tallest column decides the height, and the root column is one card tall, so the floor of
    // one keeps a chart with a single lonely adopter from computing a negative box.
    const tallest = Math.max(1, ...depths.map((depth) => byDepth.get(depth)?.length ?? 0));
    return {
      columns,
      nodes,
      edges,
      width: columnX(columns.length - 1) + CARD_WIDTH,
      height: rowY(tallest - 1) + CARD_HEIGHT,
    };
  });

  constructor() {
    // The release comes from the URL, so a navigation to another one must throw away the answer
    // about the last before the new one lands.
    effect(() => {
      const repository = this.repository();
      const version = this.version();
      untracked(() => {
        this.state.set(LOADING);
        this.rereading.set(false);
        if (repository && version) {
          void this.load();
        }
      });
    });
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  /**
   * How far away a column is, in words rather than in a number to decode.
   *
   * Short, because it is a column header now and not a full-width band: the sentence the table
   * carried — "reached through the repositories above" — is what the edges themselves say, and the
   * position of the column says the rest.
   */
  protected depthLabel(depth: number): string {
    return depth === 0 ? 'This release' : `${plural(depth, 'hop')} downstream`;
  }

  /** One read: the whole journey, which is all this page ever asks for. */
  protected async load(): Promise<void> {
    if (this.state().kind !== 'ready') {
      this.state.set(LOADING);
    }
    this.rereading.set(true);
    try {
      this.state.set(ready(await this.api.adoptionByRelease(this.repository(), this.version())));
    } catch (error) {
      this.state.set(failed(error));
    } finally {
      this.rereading.set(false);
    }
  }

  /**
   * Where a card wants to sit in its column: level with the parents that feed it.
   *
   * The mean of the parents' rows, which keeps an edge as close to horizontal as the column allows
   * and puts a card with two parents between them rather than above or below both. A card whose
   * parents this answer does not contain sorts to the end — there is nothing to be level with, and
   * the alternative, treating "no parents" as row zero, would put an unexplained card at the top of
   * the column ahead of everything the release actually reached.
   */
  private orderOf(adopter: AdopterDto, rowOf: ReadonlyMap<string, number>): number {
    const rows: number[] = [];
    if (adopter.depth <= 1) {
      rows.push(0);
    }
    for (const parent of adopter.via) {
      const row = rowOf.get(parent);
      if (row !== undefined) {
        rows.push(row);
      }
    }
    if (rows.length === 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    return rows.reduce((total, row) => total + row, 0) / rows.length;
  }

  /**
   * What a pending card is still waiting for, or nothing at all.
   *
   * An adopted card says its version and its moment in the two fields under the badge, so it needs
   * no sentence. A pending card one hop out is waiting on nothing but its own next release and says
   * exactly that — there is no edge in but the release's own. A deeper one is waiting on the cards
   * its edges come from, which the drawing already shows; repeating it in words is what the old
   * "waiting behind a → b" did, and that sentence was also wrong about the order.
   */
  private noteFor(adopter: AdopterDto): string {
    if (adopter.state === 'ADOPTED') {
      return '';
    }
    return adopter.depth <= 1 ? 'has not released with it yet' : 'waiting';
  }
}
