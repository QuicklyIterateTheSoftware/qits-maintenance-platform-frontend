import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import { Async } from '../ui/async';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * The address a link from a RELEASE lands on: `/…/trains/by-release/<repository>/<version>`.
 *
 * <p><b>It exists because the linker does not know the id.</b> A release request in qits-projects,
 * a CI run, a chat message — each of them has a repository and a version, and the train's id is
 * minted here when the release event arrives. Publishing that id back would be a second coordinate
 * system and a write across a boundary that carries none; resolving it here costs one query and no
 * contract.
 *
 * <p><b>The redirect is `replaceUrl`</b>, so pressing back returns to whatever linked here rather
 * than to this page, which would resolve again and bounce the reader forward. That is the whole
 * reason this is a component and not a plain route redirect: the answer needs a request.
 *
 * <p><b>A 404 is a calm sentence, not an error page.</b> Most releases the platform has ever made
 * predate train tracking, and a release of something nothing consumes opens no train either. Neither
 * is a fault, and a red banner would say one had happened. Every other status IS reported as an
 * error, because a 400 here means the link was built with half a pair — a bug in whoever built it,
 * and worth being able to read.
 *
 * <p>Both segments are `encodeURIComponent`-safe in both directions: the router decodes what it
 * matched, and `MaintenanceApi` sends them as query parameters.
 */
@Component({
  selector: 'app-train-by-release-resolver',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton],
  template: `
    <app-async
      [state]="asyncState()"
      loadingLabel="Looking for the release train"
      errorLabel="Could not look up the release train"
      (retry)="resolve()"
    />

    @if (missing()) {
      <p class="miss">
        No train recorded for this release — it predates train tracking. {{ repository() }}&#64;{{
          version()
        }}
        released, but nothing here followed what consumed it; a release of something no repository
        pins opens no train either.
      </p>
      <qits-button variant="secondary" size="sm" (pressed)="resolve()">Look again</qits-button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .miss {
      margin: 0.5rem 0;
      color: #6b7280;
    }
  `,
})
export class TrainByReleaseResolver {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(MaintenanceApi);
  private readonly scoped = injectScopedProject();

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly state = signal<Loadable<string>>(IDLE);

  protected readonly repository = computed(() => this.params().get('repository') ?? '');
  protected readonly version = computed(() => this.params().get('version') ?? '');

  /**
   * The one refusal that is an ordinary answer rather than a failure.
   *
   * A 404 is drawn as the sentence above; everything else — a 400 from a half-built link, a 503
   * from a service that is down — reaches `app-async`, which says what it was and offers a retry.
   */
  protected readonly missing = computed(() => {
    const state = this.state();
    return state.kind === 'error' && state.status === 404;
  });

  /**
   * What `app-async` is shown, which is the state with the calm refusal taken out of it.
   *
   * The 404 stays in `state` because that is where its status lives; hiding it from the banner here
   * is what keeps one screen from carrying both a red alert and a sentence saying nothing is wrong.
   */
  protected readonly asyncState = computed<Loadable<string>>(() =>
    this.missing() ? IDLE : this.state(),
  );

  private resolvedFor = '';

  constructor() {
    effect(() => {
      const key = `${this.repository()}@${this.version()}`;
      if (!this.repository() || !this.version() || this.resolvedFor === key) {
        return;
      }
      this.resolvedFor = key;
      void this.resolve();
    });
  }

  /** One lookup, and a hit replaces this address with the journey it names. */
  protected async resolve(): Promise<void> {
    this.state.set(LOADING);
    try {
      const train = await this.api.trainByRelease(this.repository(), this.version());
      this.state.set(ready(train.id));
      void this.router.navigate([...this.scoped.commands(), 'trains', train.id], {
        replaceUrl: true,
      });
    } catch (error) {
      // Every refusal is kept whole, 404 included: the status is the entire distinction between
      // "no train was ever recorded" and "the service is down", and only one of those is calm.
      this.state.set(failed(error));
    }
  }
}
