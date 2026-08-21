import { InjectionToken } from '@angular/core';

/**
 * The origin every request in this app is built on, and it is empty on purpose.
 *
 * The SPA is served at `/maintenance/` by qits-platform-maintenance itself, behind the same edge
 * that serves `/maintenance/api/…` — so a same-origin absolute path is not a shortcut, it is the
 * whole reason the browser's session cookie reaches the service. **This application handles no
 * token.** The edge performs the login, forward-auths the request and asserts the operator's roles
 * to the service; a configured base URL would move these calls cross-origin, the cookie would stay
 * behind, and every read would answer 401 with nothing on screen to explain it.
 *
 * It is a token rather than a constant for one reason: a spec needs a seam to assert the path
 * against. That is the shape every sibling SPA uses, and it adds no behaviour, only a handle.
 */
export const QITS_API_BASE = new InjectionToken<string>('qits.api-base', {
  providedIn: 'root',
  factory: () => '',
});
