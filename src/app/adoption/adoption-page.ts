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
import type { AdopterDto, AdoptionJourneyDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/** The header of one group of rows: everything the same number of hops downstream. */
interface DepthRow {
  readonly kind: 'depth';
  readonly key: string;
  readonly depth: number;
  /** How many repositories are at this distance, and how many of them have taken the release. */
  readonly total: number;
  readonly adopted: number;
}

/** One repository downstream of the release, at the distance of the header above it. */
interface AdopterRow {
  readonly kind: 'adopter';
  readonly key: string;
  readonly adopter: AdopterDto;
  /** Whether there is a repository page to link to — see `AdopterDto.repositoryStatus`. */
  readonly linkable: boolean;
  /** What the row says it did, or what it is still waiting behind. */
  readonly note: string;
}

type JourneyRow = DepthRow | AdopterRow;

/**
 * One release, and how far it has travelled.
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
 * <p><b>Grouped by distance, in the service's own order.</b> A depth header carries the rows at that
 * many hops, and the rows inside it arrive in the order the service sent them; nothing is re-sorted
 * here, for the reason every listing in this app gives — a client that ordered rows would disagree
 * with its own caption the moment two of them tied.
 *
 * <p><b>Two states, and PENDING is not a failure.</b> An adopted row says which of that
 * repository's own releases first carried a new-enough copy, and when; a pending one says which
 * repositories it is reached through, because a repository three hops down is waiting on the ones
 * above it rather than on this release.
 *
 * <p><b>Nothing polls.</b> A pending row moves when a downstream repository releases, which is
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
   * for any pair. But with nothing known to have been published, no downstream row can ever match,
   * and a page of PENDING rows with no explanation would read as a platform that had stopped.
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

  /** The release reached nobody — read off the adopters and not off `rows`, which holds headers. */
  protected readonly reachedNothing = computed(() => this.adopters().length === 0);

  /**
   * The table's rows: one header per distance, and the repositories at it underneath.
   *
   * Grouped by first appearance rather than by sorting, so the service's order survives whatever it
   * decides that order is — today `depth` ascending then name.
   */
  protected readonly rows = computed<readonly JourneyRow[]>(() => {
    const groups = new Map<number, AdopterDto[]>();
    for (const adopter of this.adopters()) {
      const at = groups.get(adopter.depth);
      if (at) {
        at.push(adopter);
      } else {
        groups.set(adopter.depth, [adopter]);
      }
    }
    const rows: JourneyRow[] = [];
    for (const [depth, adopters] of groups) {
      rows.push({
        kind: 'depth',
        key: `depth-${depth}`,
        depth,
        total: adopters.length,
        adopted: adopters.filter((adopter) => adopter.state === 'ADOPTED').length,
      });
      for (const adopter of adopters) {
        rows.push({
          kind: 'adopter',
          key: `${depth}|${adopter.repository}`,
          adopter,
          linkable: !!adopter.repositoryStatus,
          note: this.noteFor(adopter),
        });
      }
    }
    return rows;
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

  /** How far away a group of rows is, in words rather than in a number to decode. */
  protected depthLabel(depth: number): string {
    if (depth <= 1) {
      return 'Directly downstream — these pin what this release published';
    }
    return `${depth} hops downstream — reached through the repositories above`;
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
   * What one row did, or what it is waiting behind.
   *
   * An adopted row names the release of ITS OWN that first carried a new-enough copy of the
   * subject; a pending one names the repositories the trace came through, because that is where the
   * wait actually is — a repository two hops down cannot take this release until the one above it
   * has released with it. A pending row at depth 1 is waiting on nothing but its own next release,
   * and says so.
   */
  private noteFor(adopter: AdopterDto): string {
    if (adopter.state === 'ADOPTED') {
      return adopter.adoptedVersion ?? NONE;
    }
    return adopter.via.length > 0
      ? `waiting behind ${adopter.via.join(' → ')}`
      : 'has not released with it yet';
  }
}
