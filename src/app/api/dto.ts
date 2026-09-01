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

/**
 * Which half of the inventory something belongs to — the one distinction this application is
 * organised around.
 *
 * Internal is what the platform publishes and can release; external is what the world publishes and
 * qits-platform-mirror caches. A screen answers one of those questions at a time, because the two
 * have different readers: "what of ours is stale here" is a release question, "what of the world's
 * is stale here" is a patching one.
 */
export type InventorySection = 'INTERNAL' | 'EXTERNAL';

/**
 * Whether a dependency is one of ours, the world's, or neither.
 *
 * `REACTOR` is a module of the build that declares it — a maven sibling in the same tree, which has
 * no registry to be behind. `UNRESOLVED` is a coordinate the scan could not place in either world.
 * Both are pins a manifest really holds, and neither is ever going to move, which is why the
 * repository page keeps them out of the two tables a reader is actually working through.
 */
export type PinKind = InventorySection | 'REACTOR' | 'UNRESOLVED';

/**
 * How a dependency reaches the repository. `DIRECT` is the only value the service sends, because a
 * pin is by definition a line in a manifest; what a released artifact merely *contains* is a
 * `TransitiveDto` and not a pin at all. It is on the wire so that a page drawing both in one table
 * reads the distinction off the row rather than off which array the row came out of.
 */
export type PinScope = 'DIRECT';

/** Whether the repository asked for a grouping, or was given the fallback one. */
export type GroupSource = 'CONFIG' | 'DEFAULT';

/** How far an artifact's bill of materials got. `MISSING` is ordinary, not a fault. */
export type SbomStatus = 'PENDING' | 'INGESTED' | 'MISSING' | 'FAILED';

/**
 * One maintenance group of a repository, and the branch it bumps on.
 *
 * `kind` and `source` are two different questions. `source` says whether the repository asked for
 * this grouping; `kind` says HOW it claims — by the pins' kind, or by globs the repository wrote.
 * A configured group claims by globs and so names no kind, which is why `kind` is nullable and why
 * `groupSection` — not a bare comparison — is what decides which screen shows it.
 */
export interface GroupDto {
  readonly name: string;
  readonly source?: GroupSource | null;
  readonly kind?: InventorySection | null;
  readonly branch: string;
  readonly state: BranchState;
  readonly headSha?: string | null;
  readonly pending: number;
}

/**
 * Which section a group is drawn under.
 *
 * A group that names no kind claims by globs of its own, and there is no honest way to sort it into
 * one world — so it is shown with the internal side, where the platform's own releases are, rather
 * than being hidden from both. The same fallback covers a `kind` this build has not been taught.
 */
export function groupSection(group: GroupDto): InventorySection {
  return group.kind === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
}

/** A repository as the overview lists it: the last scan, and what is waiting to move. */
export interface RepositoryDto {
  readonly name: string;
  /** The project that owns it in the catalog, or null for a repository no project claims. */
  readonly project?: string | null;
  readonly lastScanAt: string | null;
  /** The commit the pins below were read at, or null when nothing has been read yet. */
  readonly headSha?: string | null;
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
  /**
   * Why the last lookup of `latest` failed, or null when it did not.
   *
   * A pin whose registry could not be reached has a null `latest` and a false `pending`, which is
   * indistinguishable on screen from a pin that is up to date — so this is drawn wherever `latest`
   * is. A failed lookup must never read as good news.
   */
  readonly latestError: string | null;
  readonly pending: boolean;
  readonly group: string;
  readonly location: string;
  /** Always `DIRECT`: a pin is a line in a manifest. See `PinScope`. */
  readonly scope: PinScope;
}

/**
 * One thing a repository's released artifacts CONTAIN that no manifest of theirs names.
 *
 * **Deliberately not a pin.** There is no line to edit, no location, no group and no bump — which
 * is why it is drawn greyed, under the direct dependency that pulled it in, and never in the amber
 * a pending pin gets. What it is for is seeing: a vulnerable library three levels down is invisible
 * on a page built from manifests alone, and it is the first thing anybody asks about after an
 * advisory.
 *
 * `via` is the direct component whose subtree pulled it in — null when the artifact's own root
 * names it. `behind` is false whenever nothing is known, because "we could not find out" must not
 * read like "you are behind".
 */
export interface TransitiveDto {
  /** Null when the purl named a world this service does not inventory. */
  readonly ecosystem: string | null;
  readonly name: string;
  readonly version: string;
  readonly via: string | null;
  readonly behind: boolean;
}

/** One repository with its pins and what its artifacts contain — `GET /repositories/{name}`. */
export interface RepositoryDetailDto extends RepositoryDto {
  readonly pins: readonly PinDto[];
  readonly transitives: readonly TransitiveDto[];
}

/** Who pins a dependency, at what version, and whether a bump would move that line. */
export interface DependencyPinDto {
  readonly repository: string;
  readonly version: string;
  readonly manifestPath: string;
  /** The service's own verdict, and the same one the bump uses. Never a comparison made here. */
  readonly pending: boolean;
}

/** One dependency across the whole catalog — the "who still pins this" answer. */
export interface DependencyDto {
  readonly ecosystem: string;
  readonly name: string;
  readonly latest: string | null;
  /** When the registry was last asked, or null when it never was. */
  readonly checkedAt?: string | null;
  /** Why the last ask failed, or null when it did not. */
  readonly error?: string | null;
  readonly pins: readonly DependencyPinDto[];
}

/**
 * One thing this platform publishes, as the internal listing shows it.
 *
 * `dependentCount` and `behindCount` are the two numbers that page exists for: how far a library's
 * reach goes, and how much of that reach is stale. Both are counted over the newest released
 * version of each dependent, because that is the only one anybody can still do anything about.
 */
export interface ArtifactDto {
  readonly ecosystem: string;
  readonly name: string;
  /** Which repository produced the newest release of it. */
  readonly repository: string;
  readonly latest: string | null;
  /** The newest version this service has a release row for. */
  readonly version: string;
  readonly occurredAt: string | null;
  readonly sbomStatus: SbomStatus;
  readonly dependentCount: number;
  readonly behindCount: number;
}

/** One artifact of ours that embeds another — the newest release of it, and what it shipped. */
export interface DependentDto {
  readonly artifactEcosystem: string;
  readonly artifactName: string;
  readonly artifactVersion: string;
  /** The repository that built it, which is where a reader goes next. */
  readonly repository: string;
  /** The version of the subject that this release actually contains. */
  readonly embeddedVersion: string;
  /** Whether its own manifest names the subject, or something in its tree does. */
  readonly direct: boolean;
  readonly occurredAt: string | null;
  readonly sbomStatus: SbomStatus;
}

/** Everything that embeds one dependency — `GET /dependencies/dependents`. */
export interface DependentsDto {
  readonly ecosystem: string;
  readonly name: string;
  readonly latest: string | null;
  readonly dependents: readonly DependentDto[];
}

/** One artifact of a repository, with what embeds it. */
export interface ArtifactDependentsDto {
  readonly ecosystem: string;
  readonly name: string;
  /** The newest version the service knows for this artifact; null before any lookup or event. */
  readonly latest: string | null;
  readonly dependents: readonly DependentDto[];
}

/** What consumes a repository's artifacts — `GET /repositories/{name}/dependents`. */
export interface RepositoryDependentsDto {
  readonly repository: string;
  readonly artifacts: readonly ArtifactDependentsDto[];
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
 *
 * `releaseRequestId` is what the release door said when the branch was offered to it. It is a
 * request id, or one of the two sentinels below, or null for a bump that never got that far.
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
  /** Every run this bump started, newest last — `ciRunId` is the one a reader is sent to. */
  readonly ciRunIds?: readonly string[] | null;
  /** The CI configuration the run was read from. */
  readonly configPath?: string | null;
  /** The run's own status, which is qits-ci's word and not this service's. */
  readonly ciRunStatus?: string | null;
  readonly status: BumpStatus;
  readonly changes?: readonly BumpChangeDto[];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly message: string | null;
  readonly releaseRequestId: string | null;
}

/** The branch was already integrated, or gone, so there was nothing to ask the door for. */
export const RELEASE_CONVERGED = 'converged';

/** The door refused in a way a retry cannot fix; the bump's `message` is the sentence. */
export const RELEASE_REFUSED = 'refused';

/**
 * What a `releaseRequestId` that is not a request id means, or null when it is one.
 *
 * The two sentinels are written into the same column as a real id, so a page that linked the value
 * blindly would offer a reader a release request called “refused”. They are rendered as they arrive
 * — that is what the column holds — with the sentence that explains them beside.
 */
export function releaseSentinel(releaseRequestId: string | null | undefined): string | null {
  if (releaseRequestId === RELEASE_CONVERGED) {
    return 'the branch was already integrated — nothing was asked for';
  }
  if (releaseRequestId === RELEASE_REFUSED) {
    return 'the door refused; the message says why';
  }
  return null;
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
