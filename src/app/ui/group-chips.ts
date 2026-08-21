import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { GroupDto } from '../api/dto';
import { StatusBadge } from './status-badge';

/**
 * A repository's maintenance groups, as chips.
 *
 * A group is three facts that are only useful together — what it is called, which branch it bumps
 * on, and where that branch stands — so they are drawn as one object rather than three columns.
 * The pending count rides along because "2 waiting" is why a reader opens the repository at all.
 *
 * Not a link: the chip sits in a row whose name is already the link to the repository, and a second
 * target to the same page would be one more thing to aim at for nothing.
 */
@Component({
  selector: 'app-group-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadge],
  template: `
    @if (groups().length === 0) {
      <span class="none">no groups</span>
    } @else {
      <span class="chips">
        @for (group of groups(); track group.name) {
          <span class="chip" [class.chip-pending]="group.pending > 0">
            <span class="mono">{{ group.name }} · {{ group.branch }}</span>
            <app-status-badge [status]="group.state" />
            @if (group.pending > 0) {
              <span class="pending">{{ group.pending }} pending</span>
            }
          </span>
        }
      </span>
    }
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      background: #fff;
      white-space: nowrap;
      font-size: 0.85rem;
    }
    .chip-pending {
      border-color: #fcd34d;
      background: #fffbeb;
    }
    .pending {
      color: #92400e;
      font-weight: 600;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85em;
    }
    .none {
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class GroupChips {
  readonly groups = input.required<readonly GroupDto[]>();
}
