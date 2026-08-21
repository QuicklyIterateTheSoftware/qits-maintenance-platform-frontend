import type { QitsBadgeTone } from '@qits/ui-components';

/**
 * What colour a status word is, in one place, for every badge on every page.
 *
 * `QitsBadge` takes a *semantic* tone and never a colour, so this file is a translation between two
 * vocabularies rather than styling. Three enums share it — a repository's scan status, a branch's
 * state and a bump's outcome — because they overlap and never collide: `FAILED` means the same
 * thing on a branch and on a bump, and no word appears in two of them with two meanings.
 *
 * **REQUESTED and RUNNING share the warning tone.** The reader's question is "what is still
 * happening", and a bump queued behind the worker and a bump in flight are the same answer to it.
 *
 * **STALE is a warning, not a failure.** A branch someone rewrote by hand is not broken — the
 * service simply stops pushing to it, and a person owns it now.
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
