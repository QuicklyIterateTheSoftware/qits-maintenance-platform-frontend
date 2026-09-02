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
import { MaintenanceApi } from '../api/maintenance-api';
import { injectScopedProject } from '../nav/scoped-project';
import type { ArtifactDto, DependentDto, DependentsDto } from '../api/dto';
import { DependentsTable } from '../repositories/dependents-table';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatInstant, formatRelative, plural } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * What the platform publishes, and what is still shipping an old copy of it.
 *
 * <p><b>This is the internal half of the dependency question, and it is a different question from
 * the external one.</b> "Who pins Quarkus 3.29" is answered from manifests, because a manifest is
 * what a patch has to edit. "Who is still shipping eventstream 2026.8.1" cannot be: a service that
 * pins the newest version and has not been rebuilt is still shipping the old one, and its manifest
 * says nothing about that. So this page is built from what was actually RELEASED — the bills of
 * materials of the artifacts this platform has published — which is the only place that fact lives.
 *
 * <p><b>The subject is in the URL, as two query parameters.</b> An ecosystem and a name: `@qits/…`
 * holds a slash, a maven coordinate holds a colon, and both would have to be escaped into a path
 * segment. As query parameters the answer is shareable, the back button means "the previous
 * artifact", and a reload shows the same thing.
 *
 * <p><b>Two reads, neither of them polled.</b> A release is a fact that already happened; nothing
 * on this page can change while it is being read, so there is nothing to follow. The listing is
 * fetched even on a deep link into one artifact, because it is where the newest release's version
 * and ingest state are read from — the dependents call carries neither.
 */
@Component({
  selector: 'app-internal-dependencies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, DependentsTable, Empty, RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './internal-dependencies-page.css'],
  templateUrl: './internal-dependencies-page.html',
})
export class InternalDependenciesPage {
  /** The project the address names — what the header says and what every in-app link keeps. */
  protected readonly scoped = injectScopedProject();

  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly none = NONE;
  /** The clock the "built" and "newest" columns are drawn against. */
  protected readonly now = tickingNow(30000);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** The artifact the URL asks about — both halves, or neither. */
  protected readonly ecosystem = computed(() => this.query().get('ecosystem') ?? '');
  protected readonly name = computed(() => this.query().get('name') ?? '');

  /** Whether the page is showing one artifact's dependents rather than the listing. */
  protected readonly selected = computed(() => !!this.ecosystem() && !!this.name());

  protected readonly artifactsState = signal<Loadable<readonly ArtifactDto[]>>(LOADING);
  protected readonly dependentsState = signal<Loadable<DependentsDto>>(IDLE);

  protected readonly artifacts = computed<readonly ArtifactDto[]>(() => {
    const state = this.artifactsState();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly caption = computed(() => plural(this.artifacts().length, 'artifact'));

  /** The listing's row for the artifact on screen — its newest release, and how its SBOM went. */
  protected readonly artifact = computed<ArtifactDto | null>(() => {
    const ecosystem = this.ecosystem();
    const name = this.name();
    return (
      this.artifacts().find(
        (candidate) => candidate.ecosystem === ecosystem && candidate.name === name,
      ) ?? null
    );
  });

  protected readonly dependents = computed<readonly DependentDto[]>(() => {
    const state = this.dependentsState();
    return state.kind === 'ready' ? (state.value.dependents ?? []) : [];
  });

  /** The newest version anything knows of, against which "up to date" is decided in the table. */
  protected readonly subjectLatest = computed(() => {
    const state = this.dependentsState();
    return state.kind === 'ready' ? state.value.latest : null;
  });

  constructor() {
    void this.loadArtifacts();

    // The subject is the URL's, so a click on another name — or the back button — must throw away
    // the answer on screen and ask again.
    effect(() => {
      const ecosystem = this.ecosystem();
      const name = this.name();
      untracked(() => {
        if (ecosystem && name) {
          void this.loadDependents();
        } else {
          this.dependentsState.set(IDLE);
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

  /** The listing, in the service's own order — never re-sorted here. */
  protected async loadArtifacts(): Promise<void> {
    if (this.artifactsState().kind !== 'ready') {
      this.artifactsState.set(LOADING);
    }
    try {
      this.artifactsState.set(ready(await this.api.artifacts()));
    } catch (error) {
      this.artifactsState.set(failed(error));
    }
  }

  /** Everything that embeds the artifact the URL names. */
  protected async loadDependents(): Promise<void> {
    this.dependentsState.set(LOADING);
    try {
      this.dependentsState.set(
        ready(await this.api.artifactDependents(this.ecosystem(), this.name())),
      );
    } catch (error) {
      this.dependentsState.set(failed(error));
    }
  }
}
