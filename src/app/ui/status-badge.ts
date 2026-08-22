import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, type QitsBadgeTone } from '@qits/ui-components';
import { toneOf } from './status-tone';

/**
 * A status word — a repository's scan, a branch's state, a bump's outcome — in the platform's badge.
 *
 * A wrapper rather than a bare `qits-badge` in each template, for the reason the CI SPA's copy
 * gives: "what colour is STALE" is answered once, in `status-tone.ts`, and every place a status
 * appears asks the same question of the same map.
 */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge],
  template: `<qits-badge [label]="status()" [tone]="tone()" />`,
})
export class StatusBadge {
  readonly status = input.required<string>();

  protected readonly tone = computed<QitsBadgeTone>(() => toneOf(this.status()));
}
