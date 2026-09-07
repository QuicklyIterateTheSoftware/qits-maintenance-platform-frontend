import type { QitsBadgeTone } from '@qits/ui-components';

/**
 * What colour a status word is, in one place, for every badge on every page.
 *
 * `QitsBadge` takes a *semantic* tone and never a colour, so this file is a translation between two
 * vocabularies rather than styling. Six enums share it — a repository's scan status, a branch's
 * state, a bump's outcome, an artifact's bill of materials, a dependent's currency and a downstream
 * repository's adoption of a release — because they overlap and never collide: `FAILED` means the
 * same thing on a branch, on a bump and on an ingest, and no word appears in two of them with two
 * meanings.
 *
 * **PENDING is the same amber for an adoption as for an SBOM**, and that is the shared word
 * working rather than a collision: both mean "nothing has happened here yet, and something is
 * expected to".
 *
 * **REQUESTED and RUNNING share the warning tone.** The reader's question is "what is still
 * happening", and a bump queued behind the worker and a bump in flight are the same answer to it.
 *
 * **STALE is a warning, not a failure.** A branch someone rewrote by hand is not broken — the
 * service simply stops pushing to it, and a person owns it now.
 *
 * **MISSING and UNKNOWN are neutral, and that is the whole point of them.** An artifact with no
 * bill of materials, and a dependent whose subject has no known latest, are both "we cannot say" —
 * and a red badge would read as "something is wrong here", which is a different sentence.
 */
const TONES: Readonly<Record<string, QitsBadgeTone>> = {
  // A repository's last scan.
  OK: 'success',
  ABSENT: 'neutral',
  UNREACHABLE: 'danger',
  CONFIG_ERROR: 'danger',
  // A group's maintenance branch.
  NONE: 'neutral',
  PUSHED: 'info',
  STALE: 'warning',
  RELEASED: 'success',
  // A bump.
  REQUESTED: 'warning',
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  NOTHING_TO_DO: 'neutral',
  // An artifact's bill of materials.
  PENDING: 'warning',
  INGESTED: 'success',
  MISSING: 'neutral',
  // Whether a dependent ships the newest version of what it embeds.
  CURRENT: 'success',
  BEHIND: 'warning',
  UNKNOWN: 'neutral',
  // Whether a downstream repository has taken a release. PENDING is the amber above, deliberately
  // shared: a repository that has not released with the new version yet is waiting, exactly as an
  // artifact whose bill of materials has not arrived is. ADOPTED is information rather than
  // success — the release travelling downstream is the ordinary course of things, not an outcome.
  ADOPTED: 'info',
};

/**
 * The tone for a status word.
 *
 * `neutral` for a status this build has not been taught: a new enum value on the service side must
 * render as a plain grey badge rather than crash a table or silently claim success.
 */
export function toneOf(status: string): QitsBadgeTone {
  return TONES[status] ?? 'neutral';
}
