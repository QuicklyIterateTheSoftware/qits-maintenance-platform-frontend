import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { QITS_SCOPE, scopeCommands, scopePath } from '@qits/ui-components';
import { filter, map } from 'rxjs';

/**
 * The four views, in the order a reader meets them: two inventory sections with two views each.
 *
 * `segment` is the path *inside* the scope, not the whole address: under `/qits/internal` the
 * project slug is the chrome's business, and this menu is still choosing between the same four
 * views. It doubles as each entry's key, which is what `selected()` below answers with. `commands`
 * is built from the scope on screen, so a click keeps the reader in it.
 *
 * **There is no Releases heading any more.** It held the release trains, which were a listing
 * because they were rows this service stored; what replaced them — the adoption journey of one
 * release — is evaluated per request and has no listing to be an entry for. It is reached from a
 * release, which is where the reader already is when they ask the question.
 */
const SECTIONS = [
  {
    heading: 'Internal',
    entries: [
      { segment: 'internal', label: 'Repositories' },
      { segment: 'internal/dependencies', label: 'Dependencies' },
    ],
  },
  {
    heading: 'External',
    entries: [
      { segment: 'external', label: 'Repositories' },
      { segment: 'external/dependencies', label: 'Dependencies' },
    ],
  },
] as const;

/**
 * Which entry the address on screen belongs to, as that entry's own segment.
 *
 * **A repository page, a bump page and an adoption journey are internal.** None of them is an entry
 * — each is reached by following a link — and none names a section: a repository's page shows both
 * halves of what it pins, a bump belongs to a group rather than to a section, and a journey is
 * about one release of one repository. They still have to leave *some* entry lit, and it is
 * Internal › Repositories: that listing is the front door, it is the only place a reader arrives at
 * a repository from inside this app, and it is where "back" means something. Marking nothing would
 * read as a fault; marking External would be a lie.
 *
 * The bare root and the legacy `/dependencies` both answer with the entry their redirect is heading
 * for, because this menu renders once before the redirect has landed and must not flicker.
 */
function selected(segments: readonly string[]): string {
  const [first, second] = segments;
  if (first === 'external') {
    return second === 'dependencies' ? 'external/dependencies' : 'external';
  }
  if (first === 'dependencies' || (first === 'internal' && second === 'dependencies')) {
    return 'internal/dependencies';
  }
  return 'internal';
}

/**
 * This application's own menu, under its entry in the platform navigation.
 *
 * <p>Two labelled inventory sections with two entries each, because there are two inventories and
 * two ways into each of them: by repository — "what is this repo behind on" — and by dependency —
 * "who still pins this", or for the internal side "what still ships an old copy of this". The
 * section is the first choice a reader makes, so it is a heading rather than a fifth link.
 *
 * <p>Everything else this application draws — a repository, a bump, the adoption journey of one
 * release — is reached from one of those four and has no entry of its own. A menu entry is for a
 * question a reader arrives with; the rest are questions the pages hand them.
 *
 * <p>The selection is derived from the router rather than held here: a reader arriving on a deep
 * link, or pressing back, must leave the menu showing the view actually on screen. That is also why
 * the match is a function of the URL and not `routerLinkActive` — a prefix match would light
 * `internal` on `internal/dependencies` as well.
 *
 * <p>Declared by the shell, not by a page: `RouterOutlet` destroys the outgoing component after
 * creating the incoming one, so a declaration inside a page would be torn down and rebuilt on every
 * hop, in a menu that did not itself change.
 */
@Component({
  selector: 'app-maintenance-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav aria-label="Maintenance views">
      @for (section of sections(); track section.heading) {
        <p class="section">{{ section.heading }}</p>
        @for (entry of section.entries; track entry.label) {
          <a
            [routerLink]="entry.commands"
            [class.current]="entry.current"
            [attr.aria-current]="entry.current ? 'page' : null"
            >{{ entry.label }}</a
          >
        }
      }
    </nav>
  `,
  styles: `
    /* The layout contributes a bare block and no opinions, so every rule this menu needs is here.
       It renders inside a 240px column that already scrolls and pads, hence no padding of its own. */
    :host {
      display: block;
      min-width: 0;
      padding: 4px 0 8px;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    /* The section a group of links belongs to. Not a link itself: there is no page for "Internal"
       as such, and a heading that navigated would be one more thing to press by accident. */
    .section {
      margin: 8px 0 2px;
      padding: 0 10px;
      color: #9ca3af;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .section:first-child {
      margin-top: 0;
    }
    a {
      padding: 4px 10px;
      border-left: 2px solid transparent;
      color: #4b5563;
      text-decoration: none;
      font-size: 13px;
    }
    a:hover {
      color: #111827;
    }
    a.current {
      border-left-color: #4338ca;
      color: #111827;
      font-weight: 600;
    }
  `,
})
export class MaintenanceNav {
  private readonly router = inject(Router);

  /**
   * The scope the address states. Optional: a spec that renders this menu alone gets the unscoped
   * answer, which is what the menu shows at the root of this host.
   */
  private readonly scope = inject(QITS_SCOPE, { optional: true });

  /**
   * The URL, as a signal, because Angular 21.2 has no signal-valued `Router.url` — only a string
   * getter and `currentNavigation`, which is null once a navigation has finished. The seed matters
   * as much as the stream: a reader who lands directly on a deep link gets no `NavigationEnd`
   * before the first render.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly sections = computed(() => {
    const scope = this.scope?.scope() ?? {};
    const base = scopePath(scope);
    const path = this.url().split('#')[0].split('?')[0];
    // What the reader is looking at *inside* the scope. The project slug is the chrome's, so it is
    // stripped before the match — otherwise every scoped address would read as the root's entry.
    const inside = path.startsWith(base) ? path.slice(base.length) : path;
    const current = selected(inside.split('/').filter(Boolean));
    return SECTIONS.map((section) => ({
      heading: section.heading,
      entries: section.entries.map((entry) => ({
        commands: [...scopeCommands(scope), ...entry.segment.split('/')],
        label: entry.label,
        current: entry.segment === current,
      })),
    }));
  });
}
