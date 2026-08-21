import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { NotFound } from './not-found/not-found';

/**
 * Four addresses, all of them inside the platform chrome.
 *
 * **`QitsMainLayout` is the root route component** — the platform's convention, stated in the
 * component's own docs. Mounted this way the bar and the navigation mount once and survive every
 * navigation beneath them; wrapping each page in a tag would rebuild the whole skeleton on every
 * hop. It is an eager import for that reason: it is not a page, it is the frame the pages arrive
 * in, and a frame that loaded in its own chunk would show a blank application while it did.
 *
 * **The path shape repeats the API's, noun for noun.** `/maintenance/repositories/qits-ci` is the
 * page for what `GET /maintenance/api/repositories/qits-ci` answers, and `/maintenance/bumps/<id>`
 * for `GET /maintenance/api/bumps/<id>`. A bump is addressed by its id alone, because that is its
 * identity: it belongs to a repository and a group, but a reader following a link out of a CI run
 * or a chat message has the id and nothing else.
 *
 * **The dependency search is a query parameter, not a segment.** `?name=@qits/*` is view state
 * rather than a resource, it holds slashes and asterisks, and a query parameter is what makes the
 * back button mean "the previous search".
 *
 * **Every one of these is a deep link a reader will paste.** They survive a reload only because
 * qits-platform-maintenance sets `quarkus.quinoa.enable-spa-routing=true`, which answers an unknown
 * path under `/maintenance/` with `index.html` instead of a 404; `/maintenance/api` and
 * `/maintenance/q` are held back from that by `quarkus.quinoa.ignored-path-prefixes`.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./repositories/repositories-page').then((m) => m.RepositoriesPage),
      },
      {
        path: 'repositories/:name',
        loadComponent: () => import('./repositories/repository-page').then((m) => m.RepositoryPage),
      },
      {
        path: 'dependencies',
        loadComponent: () =>
          import('./dependencies/dependencies-page').then((m) => m.DependenciesPage),
      },
      {
        path: 'bumps/:id',
        loadComponent: () => import('./bumps/bump-page').then((m) => m.BumpPage),
      },
      { path: '**', component: NotFound },
    ],
  },
];
