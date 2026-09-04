# qits-maintenance-platform-frontend

The maintenance frontend: what every repository in the catalog pins, what the registries have
released since, what the platform's own releases already ship, and which maintenance branches are
waiting. Served by qits-platform-maintenance at the root of `maintenance.<env>.<domain>` through
Quinoa. Six addresses, all inside the platform chrome, and each of them reachable under a project
slug as well.

**The first segment is the section, and it is the organising idea of the application.** `internal`
is what this platform publishes and can release; `external` is what the world publishes and
qits-platform-mirror caches. Each has the same two views, because they are different questions asked
by different readers: internal is release work, external is patching.

- **`/internal`** — every repository, with its internal groups as chips: last scan, status, how
  many pins are behind. One button starts an internal scan.
- **`/internal/dependencies`** — everything the platform publishes, how far each library's reach
  goes and how much of that reach is stale. `?ecosystem=&name=` opens one of them and lists what
  still ships an old copy of it. Built from bills of materials, not from manifests.
- **`/external`** and **`/external/dependencies?name=<glob>`** — the same two views of the world's
  side. The search is the page that answers "who is still on Quarkus 3.29".
- **`/repositories/<name>`** — section-neutral: internal pins and external pins as two tables, what
  those pins drag in underneath them, what the platform already ships that contains this
  repository's artifacts, a panel per group with `Create branch now`, and the bumps it has had.
- **`/bumps/<id>`** — one bump: the branch, the changes sent, the CI run, and what the release ask
  answered.
- **`/`** redirects to `/internal`, and **`/dependencies`** — the search's address when there was
  only one of them — redirects to `/internal/dependencies` with its query parameters intact.

## The project in the address

This app is **project scoped**: `/qits/internal` is the same page as `/internal`. The literal routes
are matched first, so `internal`, `external`, `repositories`, `dependencies` and `bumps` stay this
app's own pages and never read as projects of those names.

The scope is read from the address by `@qits/ui-components` (`provideQitsScope('project')`), never
from a route parameter, so one component serves both forms. It is drawn in the page header and
changes nothing else: this inventory is the whole catalog's, and the service offers no per-project
query.

## What the pages decide

**Behind is the service's word, never a comparison made here.** Maven, npm and OCI tags order
differently, and a client that decided `2026.8.10` is behind `2026.8.9` would highlight rows the
service is not going to move. The `pending` flag on a pin is the same answer the bump uses, and it
is what the external search highlights too — it used to compare two strings itself, and disagreed
with the branch the service actually writes.

The one comparison this application does make is **equality**, in the dependents table: a release
either embeds the same string the registry calls latest or it does not. Equality needs no ordering.
Where no latest is known the verdict is `UNKNOWN` and never success — a lookup that failed must not
read as good news, which is also why a pin's `latestError` is drawn beside its blank `latest`.

**A pin can be moved; a transitive cannot.** The repository page draws both, and the difference is
the whole point of how they look: a pin that is behind is amber, and what a release merely
*contains* is grey, indented under the direct dependency that pulled it in, collapsed until it is
asked for, and never amber. There is no line to edit and no bump to press for it.

**What a repository consumes and what consumes it are read from different places.** Pins come from
manifests, because a manifest is what a bump edits. Dependents come from the bills of materials of
what has actually been released, because a service that pins the newest version and has not been
rebuilt is still shipping the old one — and its manifest says nothing about that.

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

Ten calls, pinned in the superproject's `qits-maintenance-plan.md` ("API"):

```
GET  /maintenance/api/repositories                                  → [{name, project, lastScanAt, headSha, status, message, pending, groups:[{name, source, kind, branch, state, headSha, pending}]}]
GET  /maintenance/api/repositories/{name}                           → repository + pins:[…] + transitives:[{ecosystem, name, version, via, behind}]
GET  /maintenance/api/repositories/{name}/dependents                → {repository, artifacts:[{ecosystem, name, dependents:[…]}]}
GET  /maintenance/api/dependencies?name=<glob>&kind=INTERNAL|EXTERNAL → [{ecosystem, name, latest, checkedAt, error, pins:[{repository, version, manifestPath, pending}]}]
GET  /maintenance/api/dependencies/dependents?ecosystem=&name=      → {ecosystem, name, latest, dependents:[{artifactEcosystem, artifactName, artifactVersion, repository, embeddedVersion, direct, occurredAt, sbomStatus}]}
GET  /maintenance/api/artifacts                                     → [{ecosystem, name, repository, latest, version, occurredAt, sbomStatus, dependentCount, behindCount}]
POST /maintenance/api/scans {scope, repository?}                    → 202 {id}
POST /maintenance/api/repositories/{name}/groups/{group}/bumps      → 202 {id}   (409 while one is active)
GET  /maintenance/api/bumps?repository=&limit=20                    → [bump rows]
GET  /maintenance/api/bumps/{id}                                    → one bump row
```

Six things the JSON shape alone does not say, and which these pages depend on:

- **The reads answer bare arrays and bare objects, not envelopes.** No `{items: […]}` wrapper.
- **A bump row spells its group as `group` and its CI ids as `ciEventId` / `ciRunId`**, and may
  carry a `branch`. Without one the page falls back to `maintenance/<group>`.
- **`GET /repositories/{name}` carries the overview's fields too** — `status`, `lastScanAt`,
  `message` and `groups` — because the group panels and the header are drawn from them.
- **A group's `kind` is null when its globs decide**, which a configured group's do. Such a group is
  drawn with the internal side rather than hidden from both.
- **A pin's `kind` is one of four** — `INTERNAL`, `EXTERNAL`, `REACTOR`, `UNRESOLVED` — and its
  `scope` is always `DIRECT`: what a release merely contains arrives as `transitives`, separately.
- **A bump's `releaseRequestId` is a request id, or one of two sentinels** — `converged` (nothing
  came back to hold on to) and `refused`. Both are rendered as they arrive and never linked. The id
  names an OPEN release request in qits-projects, not a release: the quality gates settle it and Auto
  Release tags it afterwards.

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

The same three, in the same order, are what `.config/qits/ci-event-release-request.yml` runs on a
release request's fold — the one pipeline this repository has, since nothing builds on a push any
more. Note what that pipeline installs from: the npm proxy behind it is qits-platform-mirror, and
the `@qits` scope comes from qits-artifacts — so a run here cannot be green while either service is
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
