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
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import type { TrainSummaryDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/** One train as this listing draws it: the row, plus the progress figure spelled once. */
interface TrainRow {
  readonly train: TrainSummaryDto;
  readonly progress: string;
  /** Every consumer has landed. Not the same as COMPLETED, which is the service's own verdict. */
  readonly whole: boolean;
}

/**
 * Recent release trains: one row per release, and how far each has travelled.
 *
 * <p><b>A train is a release seen from the other side.</b> The bumps table says what this service
 * asked for; a train says what a release of ours is doing to everything that consumes it — who has
 * adopted it, who has landed it, and who has not moved. The two are different questions and neither
 * answers the other, which is why this is a listing of its own rather than a column somewhere.
 *
 * <p><b>The filter is a query parameter and never a segment.</b> `?repository=qits-eventstream` is
 * a question, not a resource, and a query parameter is what makes the back button mean "the previous
 * question" and a pasted address show the same rows. It is also the service's own filter rather than
 * one applied here: a page that dropped rows after the fact would still be paying for them and would
 * disagree with its own caption about how many there are.
 *
 * <p><b>Nothing here polls.</b> A listing of recent releases moves when a release happens, which is
 * minutes apart at best, and the reader who wants to watch one travel is one click away on its own
 * journey — which does poll. A table of fifty rows re-read every two seconds would be traffic spent
 * on a screen nobody is watching for change.
 *
 * <p>The progress figure is the service's `landedCount`/`nodeCount` and never a count made here:
 * this listing does not carry the nodes, and a figure derived from what it does carry would
 * disagree with the journey page the row links to.
 */
@Component({
  selector: 'app-trains-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './trains-page.css'],
  templateUrl: './trains-page.html',
})
export class TrainsPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly none = NONE;
  /** The clock the relative times are drawn against — a minute's resolution needs no more. */
  private readonly now = tickingNow(30000);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** The repository the address narrows to, or the empty string for every train there is. */
  protected readonly repository = computed(() => this.query().get('repository') ?? '');

  /** What is in the box, which is the URL's answer until the reader types over it. */
  protected readonly draft = signal('');

  protected readonly state = signal<Loadable<readonly TrainSummaryDto[]>>(LOADING);

  protected readonly trains = computed<readonly TrainSummaryDto[]>(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly rows = computed<readonly TrainRow[]>(() =>
    this.trains().map((train) => ({
      train,
      progress: `${train.landedCount}/${train.nodeCount}`,
      whole: train.nodeCount > 0 && train.landedCount === train.nodeCount,
    })),
  );

  protected readonly caption = computed(() => plural(this.rows().length, 'train'));

  constructor() {
    // The question is the URL's, so the back button and a pasted link both re-ask it.
    effect(() => {
      const repository = this.repository();
      untracked(() => {
        this.draft.set(repository);
        void this.load();
      });
    });
  }

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  /**
   * Put the question in the address rather than in a field of this component.
   *
   * `replaceUrl` is deliberately not used: narrowing the listing is a step a reader takes, and back
   * should undo it.
   */
  protected submit(event: Event): void {
    event.preventDefault();
    const repository = this.draft().trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { repository: repository || null },
      queryParamsHandling: 'merge',
    });
  }

  protected async load(): Promise<void> {
    if (this.state().kind !== 'ready') {
      this.state.set(LOADING);
    }
    try {
      this.state.set(ready(await this.api.trains(this.repository() || undefined)));
    } catch (error) {
      this.state.set(failed(error));
    }
  }
}
