import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { MaintenanceApi } from '../api/maintenance-api';
import type { DependencyDto } from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, plural } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * Who pins what: one dependency, and every repository holding a version of it.
 *
 * This is the page that answers "who still pins eventstream 2026.8.x" — the question a release
 * leaves behind, and the one the repository pages cannot answer because it is asked across all of
 * them at once.
 *
 * **The search is in the URL.** `?name=@qits/*` is what makes an answer shareable, what makes the
 * back button mean "the previous search", and what makes a reload show the same thing. The input is
 * seeded from it, so a pasted link fills the box as well as the table.
 *
 * **The glob is the service's to interpret.** This page sends the text as typed. A client that
 * turned `@qits/*` into a regular expression would answer a different question from the one the
 * service answers everywhere else — the group patterns in `.config/qits/maintenance.yml` are globs
 * on the same names.
 *
 * **Nothing is searched until something is asked for.** An empty box is an idle page with a hint,
 * not a listing of every dependency on the platform: that answer is thousands of rows and nobody's
 * question.
 */
@Component({
  selector: 'app-dependencies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsButton, RouterLink],
  styleUrls: ['../ui/page.css', './dependencies-page.css'],
  templateUrl: './dependencies-page.html',
})
export class DependenciesPage {
  private readonly api = inject(MaintenanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly none = NONE;

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** What the URL asks for — the whole input to the one read this page makes. */
  protected readonly term = computed(() => this.query().get('name') ?? '');

  /** What is in the box, which is only the URL's business once it is submitted. */
  protected readonly draft = signal('');

  protected readonly state = signal<Loadable<readonly DependencyDto[]>>(IDLE);

  protected readonly dependencies = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly caption = computed(() =>
    plural(this.dependencies().length, 'dependency', 'dependencies'),
  );

  constructor() {
    effect(() => {
      const term = this.term();
      untracked(() => {
        this.draft.set(term);
        this.load();
      });
    });
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  /** Submitting puts the search in the URL; the effect above is what turns that into a request. */
  protected submit(event: Event): void {
    event.preventDefault();
    const name = this.draft().trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: name ? { name } : {},
      replaceUrl: true,
    });
  }

  /** The one read, re-issued by the retry button and by nothing else. */
  protected load(): void {
    const term = this.term();
    if (!term) {
      this.state.set(IDLE);
      return;
    }
    this.state.set(LOADING);
    this.api.dependencies(term).then(
      (dependencies) => this.state.set(ready(dependencies)),
      (error: unknown) => this.state.set(failed(error)),
    );
  }

  /** A pin that is not on the latest version — said plainly, never as a version comparison. */
  protected behind(version: string, latest: string | null): boolean {
    return !!latest && version !== latest;
  }
}
