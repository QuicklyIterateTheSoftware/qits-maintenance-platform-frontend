/**
 * What qits-platform-maintenance answers, spelled as the pinned contract spells it
 * (`qits-maintenance-plan.md`, "API").
 *
 * **The reads are bare JSON, not envelopes.** The contract writes
 * `GET /repositories → [{name, …}]`, so an array is what arrives and an array is what this app
 * parses. Several sibling explorers unwrap a `{items: […]}` wrapper; this one does not, and a
 * service that grew one would break these pages silently — which is why the API spec asserts the
 * shape rather than trusting it.
 *
 * **A widened enum must not break a page.** Every status here is a union for the compiler's sake,
 * and every place that colours one falls back to neutral for a word this build has not been taught.
 */

/** How the last scan of a repository ended. */
export type RepositoryStatus = 'OK' | 'ABSENT' | 'UNREACHABLE' | 'CONFIG_ERROR';

/** Where a group's maintenance branch stands. `STALE` means someone rewrote it by hand. */
export type BranchState = 'NONE' | 'PUSHED' | 'STALE' | 'RELEASED' | 'FAILED';

/** A bump's outcome. `NOTHING_TO_DO` is a success with no commit behind it. */
export type BumpStatus = 'REQUESTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'NOTHING_TO_DO';

/** What asked for a bump: the service's own cron, or a button on this page. */
export type BumpTrigger = 'SCHEDULED' | 'MANUAL';

/** How much of the inventory a scan refreshes. */
export type ScanScope = 'INTERNAL' | 'EXTERNAL' | 'ALL';

/** Whether a dependency is one of ours or the world's. */
export type PinKind = 'INTERNAL' | 'EXTERNAL';

/** One maintenance group of a repository, and the branch it bumps on. */
export interface GroupDto {
  readonly name: string;
  readonly branch: string;
  readonly state: BranchState;
  readonly pending: number;
}

/** A repository as the overview lists it: the last scan, and what is waiting to move. */
export interface RepositoryDto {
  readonly name: string;
  readonly lastScanAt: string | null;
  readonly status: RepositoryStatus;
  readonly message: string | null;
  readonly pending: number;
  readonly groups: readonly GroupDto[];
}

/**
 * One pinned dependency, where it is pinned, and what the registry has.
 *
 * `pending` is the service's own answer to "is this behind" — a version comparison this app must
 * not repeat: maven, npm and OCI tags order differently and a client's guess would disagree with
 * the branch the service actually bumps.
 */
export interface PinDto {
  readonly manifestPath: string;
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
  readonly range: string | null;
  readonly kind: PinKind;
  readonly latest: string | null;
  readonly pending: boolean;
  readonly group: string;
  readonly location: string;
}

/** One repository with its pins — what `GET /repositories/{name}` answers. */
export interface RepositoryDetailDto extends RepositoryDto {
  readonly pins: readonly PinDto[];
}

/** Who pins a dependency, and at what version. */
export interface DependencyPinDto {
  readonly repository: string;
  readonly version: string;
  readonly manifestPath: string;
}

/** One dependency across the whole catalog — the "who still pins this" answer. */
export interface DependencyDto {
  readonly ecosystem: string;
  readonly name: string;
  readonly latest: string | null;
  readonly pins: readonly DependencyPinDto[];
}

/** One line of a bump: the pin it moves, and where that pin is written. */
export interface BumpChangeDto {
  readonly ecosystem: string;
  readonly manifestPath: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly location: string;
}

/**
 * A bump: the branch a group's pending changes were asked to land on, and how that went.
 *
 * `branch` is optional because the contract's row does not name it — the bump page falls back to
 * `maintenance/<group>`, which is the branch the service derives from the group anyway.
 *
 * `changes` is optional for a duller reason: the listing may leave it out to keep its rows small,
 * and a page that counted it blind would break on the day it does. `changeCount` is that count.
 */
export interface BumpDto {
  readonly id: string;
  readonly repository: string;
  readonly group: string;
  readonly branch?: string | null;
  readonly environment: string | null;
  readonly trigger: BumpTrigger;
  readonly ciEventId: string | null;
  readonly ciRunId: string | null;
  readonly status: BumpStatus;
  readonly changes?: readonly BumpChangeDto[];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly message: string | null;
}

/** What a 202 carries: the id of the work that was accepted, and nothing else. */
export interface AcceptedDto {
  readonly id: string;
}

/** A bump that has stopped. Only the other two are worth polling. */
export function isBumpTerminal(status: BumpStatus): boolean {
  return status !== 'REQUESTED' && status !== 'RUNNING';
}

/** How many pins a bump moves — zero for a row the listing sent without its changes. */
export function changeCount(bump: BumpDto): number {
  return bump.changes?.length ?? 0;
}

/** The branch a bump is about — the row's own, or the one its group's name implies. */
export function bumpBranch(bump: BumpDto): string {
  return bump.branch || `maintenance/${bump.group}`;
}
