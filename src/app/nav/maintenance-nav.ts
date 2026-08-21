import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';

/** The two views of one inventory, in the order a reader meets them. */
const ENTRIES = [
  { path: '/', label: 'Repositories', matches: (segments: readonly string[]) => segments[0] !== 'dependencies' },
  { path: '/dependencies', label: 'Dependencies', matches: (segments: readonly string[]) => segments[0] === 'dependencies' },
] as const;

/**
 * This application's own menu, under its entry in the platform navigation.
 *
 * <p>Two entries, because there are two ways into one inventory: by repository — "what is this repo
 * behind on" — and by dependency — "who still pins this". A repository page and a bump page are
 * reached from the first, so neither is an entry of its own; the pill above the menu still shows
 * `Repositories` while a reader is inside one, which is where they are.
 *
 * <p>The selection is derived from the router rather than held here: a reader arriving on a deep
 * link, or pressing back, must leave the menu showing the view actually on screen. That is also why
 * the match is a function of the URL and not `routerLinkActive` — `/` would otherwise be active on
 * every page, since every path starts with it.
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
      @for (entry of entries(); track entry.path) {
        <a
          [routerLink]="entry.path"
          [class.current]="entry.current"
          [attr.aria-current]="entry.current ? 'page' : null"
          >{{ entry.label }}</a
        >
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

  protected readonly entries = computed(() => {
    const path = this.url().split('#')[0].split('?')[0];
    const segments = path.split('/').filter(Boolean);
    return ENTRIES.map((entry) => ({
      path: entry.path,
      label: entry.label,
      current: entry.matches(segments),
    }));
  });
}
