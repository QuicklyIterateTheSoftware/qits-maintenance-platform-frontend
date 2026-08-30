# qits-maintenance-platform-frontend

The maintenance frontend: what every repository in the catalog pins, what the registries have
released since, and which maintenance branches are waiting. Served by qits-platform-maintenance at
the root of `maintenance.<env>.<domain>` through Quinoa. Four addresses, all inside the platform
chrome, and each of them reachable under a project slug as well.

- **`/`** — every repository: last scan, status, how many pins are behind, and its
  groups as chips. Two buttons start a scan.
- **`/repositories/<name>`** — the pins, a panel per group with `Create branch now`,
  and the bumps this repository has had.
- **`/dependencies?name=<glob>`** — who pins what. This is the page that answers "who
  still pins eventstream 2026.8.x".
- **`/bumps/<id>`** — one bump: the branch, the changes sent, and the CI run.

## The project in the address

This app is **project scoped**: `/qits/dependencies` is the same page as `/dependencies`. The
literal routes are matched first, so `repositories`, `dependencies` and `bumps` stay this app's own
pages and never read as projects of those names.

The scope is read from the address by `@qits/ui-components` (`provideQitsScope('project')`), never
from a route parameter, so one component serves both forms. It is drawn in the page header and
changes nothing else: this inventory is the whole catalog's, and the service offers no per-project
query.

## What the pages decide

**Behind is the service's word, never a comparison made here.** Maven, npm and OCI tags order
differently, and a client that decided `2026.8.10` is behind `2026.8.9` would highlight rows the
service is not going to move. The `pending` flag on a pin is the same answer the bump uses. The one
exception is the dependency search, which marks a pin whose version simply differs from `latest` —
and says "not latest" rather than "behind".

**The service holds the rules; these pages report its answers.** One bump per (repository, group) is
a `409`, and that is drawn as a sentence. The group's button is also disabled while its bump is
running, but only as a courtesy — the rule stays in one place, and a bump the schedule started a
second before a click is a state no page can have seen.

**Polling stops.** A page re-reads every two seconds while something it can see is unfinished, one
request in flight at a time, and stops for good when nothing is. A poll that fails leaves the last
good answer on screen and says so above it.

**A scan is followed by watching the rows it moves.** `POST /scans` answers an id and the contract
has no `GET /scans/{id}`, so "it finished" can only be read off `lastScanAt` — against the server's
own timestamps, never this browser's clock. The wait is bounded at three minutes, after which the
page says so instead of spinning for ever.

**This application handles no token.** Every call is a same-origin path under `/maintenance/api`,
and the edge's session is what authenticates it. That is also why no request sets a `credentials`
option: same-origin sends the cookie by default.

## The contract it consumes

Seven calls, pinned in the superproject's `qits-maintenance-plan.md` ("API"):

```
GET  /maintenance/api/repositories                                  → [{name, lastScanAt, status, message, pending, groups:[{name, branch, state, pending}]}]
GET  /maintenance/api/repositories/{name}                           → repository + pins:[…]
GET  /maintenance/api/dependencies?name=<glob>                      → [{ecosystem, name, latest, pins:[{repository, version, manifestPath}]}]
POST /maintenance/api/scans {scope}                                 → 202 {id}
POST /maintenance/api/repositories/{name}/groups/{group}/bumps      → 202 {id}   (409 while one is active)
GET  /maintenance/api/bumps?repository=&limit=20                    → [bump rows]
GET  /maintenance/api/bumps/{id}                                    → one bump row
```

Three things the JSON shape alone does not say, and which these pages depend on:

- **The reads answer bare arrays and bare objects, not envelopes.** No `{items: […]}` wrapper.
- **A bump row spells its group as `group` and its CI ids as `ciEventId` / `ciRunId`**, and may
  carry a `branch`. Without one the page falls back to `maintenance/<group>`.
- **`GET /repositories/{name}` carries the overview's fields too** — `status`, `lastScanAt`,
  `message` and `groups` — because the group panels and the header are drawn from them.

## How it is served

qits-maintenance-platform-service — the repository behind the qits-platform-maintenance application
— carries this repository as a git submodule at `service/src/main/webui` — Quinoa's ui-dir — and
builds it during `mvn package`, serving the bundle at the root of its own host. `baseHref` here is `/` and `quarkus.quinoa.ui-root-path` there is `/`, so there is no segment
left for the two to disagree about. Deep links need `quarkus.quinoa.enable-spa-routing=true` there;
the whole `/maintenance` wire prefix is held back from the SPA by
`quarkus.quinoa.ignored-path-prefixes`. This repository ships no container image of its own.

## Development server

```bash
ng serve
```

Then open `http://localhost:4200/`. `proxy.conf.json` forwards `/maintenance/api`,
`/maintenance/q`, `/main-navigation` and `/projects/api` to an edge on `localhost:8080`, because
`ng serve` puts no edge in front. Without one running the sidebar renders "Navigation unavailable",
which is the intended degraded state rather than a fault.

## Running the checks

```bash
npm run lint && npm test && npm run build
```

The same three, in the same order, are what `.config/qits/ci-post-receive.yml` runs on every push.
Note what that pipeline installs from: the npm proxy behind it is qits-platform-mirror, and the
`@qits` scope comes from qits-artifacts — so a run here cannot be green while either service is
down.

Installing on a developer machine needs a credential, and it is not in this repository. Every read
through the edge authenticates, so both registries answer 401 without one; `.npmrc` here carries the
routing only, and the `_auth` line comes from your own `~/.npmrc`, minted for your commissioned
workstation client. With the registries unreachable — or the workstation credential expired, which
it is after a re-bootstrap — `npm ci --offline` installs the whole tree from the npm cache, because
this lockfile is the orchestrator SPA's dependency set exactly.

## Running unit tests

```bash
ng test
```

Vitest on jsdom — no browser, which is what lets CI run them. The one thing a spec cannot wait for
is time, so the poll's interval and clock are injected (`QITS_SCHEDULER`) and a spec drives them by
hand. Never a `vi.mock`: a patched module leaks between spec files and makes green depend on the
order they ran in. Check that with `taskset -c 0 npm test`.

## Building

```bash
ng build
```

The bundle lands in `dist/qits-platform-spa-maintenance/browser`, which is the path
`quarkus.quinoa.build-dir` names on the service side.
