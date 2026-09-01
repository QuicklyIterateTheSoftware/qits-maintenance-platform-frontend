import type { Route, Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { NotFound } from './not-found/not-found';

/**
 * Six addresses, all of them inside the platform chrome, and two of them redirects.
 *
 * **The first segment is the SECTION, and it is the organising idea of the whole application.**
 * `internal` is what this platform publishes and can release; `external` is what the world
 * publishes and qits-platform-mirror caches. Each has the same two views — a repository listing and
 * a dependency view — and they are different addresses rather than a toggle, because they are
 * different questions asked by different readers, and because the answer to one of them is a link
 * worth pasting on its own.
 *
 * **The section reaches the page as route `data`, never as a parameter.** `RepositoriesPage` serves
 * both listings, and a literal in the table is what keeps `/internal` from being one more string a
 * component has to validate; a `:section` parameter would also claim `/anything`, which is the
 * project form's job.
 *
 * **`QitsMainLayout` is the root route component** — the platform's convention, stated in the
 * component's own docs. Mounted this way the bar and the navigation mount once and survive every
 * navigation beneath them; wrapping each page in a tag would rebuild the whole skeleton on every
 * hop. It is an eager import for that reason: it is not a page, it is the frame the pages arrive
 * in, and a frame that loaded in its own chunk would show a blank application while it did.
 *
 * **The path shape repeats the API's, noun for noun.** `/maintenance/repositories/qits-ci` is the
 * page for what `GET /maintenance/api/repositories/qits-ci` answers, and `/maintenance/bumps/<id>`
 * for `GET /maintenance/api/bumps/<id>`. Both stay section-neutral: a repository's page shows both
 * halves of what it pins, and a bump belongs to one group rather than to one section.
 *
 * **The dependency views' state is in query parameters, not segments.** `?name=@qits/*` on the
 * external search, `?ecosystem=&name=` on the internal one: both hold slashes, colons and
 * asterisks, and a query parameter is what makes the back button mean "the previous question".
 *
 * **`/dependencies` still resolves.** It was the external search's address before there were two of
 * them, and it is in links that are already out there; it redirects to the internal view, which is
 * the front door of the application now. Query parameters survive a redirect, so a pasted
 * `?name=…` arrives with it.
 *
 * **Every one of these is a deep link a reader will paste.** They survive a reload only because
 * qits-platform-maintenance sets `quarkus.quinoa.enable-spa-routing=true`, which answers an unknown
 * path on this host with `index.html` instead of a 404; the whole `/maintenance` wire prefix is
 * held back from that by `quarkus.quinoa.ignored-path-prefixes`.
 */
const OWN: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'internal' },
  {
    path: 'internal/dependencies',
    loadComponent: () =>
      import('./dependencies/internal-dependencies-page').then((m) => m.InternalDependenciesPage),
  },
  {
    path: 'internal',
    data: { section: 'INTERNAL' },
    loadComponent: () => import('./repositories/repositories-page').then((m) => m.RepositoriesPage),
  },
  {
    path: 'external/dependencies',
    loadComponent: () => import('./dependencies/dependencies-page').then((m) => m.DependenciesPage),
  },
  {
    path: 'external',
    data: { section: 'EXTERNAL' },
    loadComponent: () => import('./repositories/repositories-page').then((m) => m.RepositoriesPage),
  },
  {
    path: 'repositories/:name',
    loadComponent: () => import('./repositories/repository-page').then((m) => m.RepositoryPage),
  },
  {
    path: 'bumps/:id',
    loadComponent: () => import('./bumps/bump-page').then((m) => m.BumpPage),
  },
  // The address the dependency search had when there was only one of them.
  { path: 'dependencies', pathMatch: 'full', redirectTo: 'internal/dependencies' },
];

/**
 * The same addresses under a project slug — `/qits/internal` beside `/internal`.
 *
 * **Order is the whole guard.** The literal routes above are matched first, so `internal`,
 * `external`, `repositories`, `dependencies` and `bumps` stay this app's own pages and never read
 * as projects of those names; only what none of them claim falls through to `:project`. A page
 * never reads this parameter: it asks `QITS_SCOPE`, which parses the address the same way in both
 * forms, so one component serves both.
 *
 * This app is project scoped and not repository scoped. A repository page here is about a
 * repository's *pins*, which the inventory keys by name across the whole catalog, so its address
 * stays `repositories/<name>` rather than becoming the platform's `<category>/<repo>` form.
 */
const SCOPED: Route = { path: ':project', children: OWN };

export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [...OWN, SCOPED, { path: '**', component: NotFound }],
  },
];
