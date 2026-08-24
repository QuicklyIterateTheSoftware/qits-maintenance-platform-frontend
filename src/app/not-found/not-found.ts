import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectScopedProject } from '../nav/scoped-project';

/**
 * A URL on this host that this app does not recognise.
 *
 * It renders a small page and stops there. There is nobody to hand the URL back to:
 * qits-platform-maintenance is served at the root of its own host, so every path the service does
 * not claim for its own wire routes is this router's.
 *
 * `/maintenance/api` and `/maintenance/q` never reach this page — the service claims the whole
 * `/maintenance` prefix ahead of the SPA, through `quarkus.quinoa.ignored-path-prefixes`, so a
 * mistyped machine path is a 404 from Quarkus rather than this component.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>
      This is maintenance. It knows what every repository pins, what the registries have released
      since, and which maintenance branches are waiting to be released — and nothing else.
    </p>
    <p><a [routerLink]="scoped.commands()">Back to the repositories</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {
  /** Back to the inventory the reader came from — the project's, where the address named one. */
  protected readonly scoped = injectScopedProject();
}
