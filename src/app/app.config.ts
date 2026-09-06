import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
} from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Seven providers, in the order every sibling explorer repeats.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries this app's state: every level of it is a path segment or a query
 *   parameter, so each screen is bookmarkable and the back button works with no code.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path behind the edge, and
 *   none of them is anonymous: the edge's session is what authenticates them, and it does so with
 *   cookies a same-origin request sends by default.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the edge for
 *   `/main-navigation` once at startup. The list is the edge's answer — derived from the
 *   deployments it actually serves — not a list compiled into @qits/ui-components; without this
 *   provider the chrome renders no links at all. It needs the `provideHttpClient` above.
 * - `provideQitsProjects` fills the chrome's project picker from one `GET /projects/api/projects`,
 *   and installs the repositories of whatever project is in scope alongside it.
 * - `provideQitsScope('project')` says how deep this application's own addresses go. The inventory
 *   is the platform's — every repository in the catalog, whichever project owns it — so the deepest
 *   address this app serves is `/<projectSlug>/…`. The scope is read from the address and nothing
 *   else, so picking a project navigates rather than remembers.
 * - `provideQitsBuilds` puts the pending-builds bolt beside the picker: a popover of what qits-ci is
 *   building right now, from `GET /ci/api/runs/active`. Same-origin like every other read here — the
 *   edge routes `/ci` on every vhost — so it needs the `provideHttpClient` above and names no origin
 *   of its own. Providing it is what puts the bolt there, exactly as no project source means no
 *   picker. Closed, it asks nothing at all; it polls only while a reader keeps the panel open.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('project'),
    provideQitsBuilds(),
  ],
};
