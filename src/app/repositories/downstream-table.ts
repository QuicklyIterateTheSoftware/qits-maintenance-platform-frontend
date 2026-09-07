import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DownstreamEntryDto } from '../api/dto';
import { injectScopedProject } from '../nav/scoped-project';
import { NONE } from '../ui/format';

/** One downstream repository, with the chain that reached it spelled once. */
interface DownstreamRow {
  readonly key: string;
  readonly entry: DownstreamEntryDto;
  /** `qits-ui-components-jslib → qits-ci-frontend`, or nothing for a repository one hop away. */
  readonly via: string;
}

/**
 * Everything downstream of a repository, however many hops away.
 *
 * <p><b>This is the dependents table followed to the end.</b> Dependents answers who consumes this
 * repository; this answers who consumes THEM, and who consumes those — which is the question a
 * release asks, because a library release reaches the service that pins the frontend that pins it,
 * and a one-hop answer stops at the frontend. The service traces it per request out of the pins and
 * the bills of materials it already holds; there is nothing stored here to go stale.
 *
 * <p><b>Depth is the row's own fact and the order is the service's.</b> Rows arrive nearest first
 * and are drawn as they arrive: a client that sorted them would disagree with the caption above
 * them the moment two of them tied.
 *
 * <p>Every name is linked to its page here, as in the dependents table: a name the closure reached
 * is a repository, and where this inventory holds no row for it that page says so in the service's
 * own words rather than being a link this table declined to draw.
 */
@Component({
  selector: 'app-downstream-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrls: ['../ui/page.css', './downstream-table.css'],
  template: `
    <div class="scroll">
      <table>
        @if (caption()) {
          <caption>
            {{
              caption()
            }}
          </caption>
        }
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Archetype</th>
            <th scope="col" class="num">Hops</th>
            <th scope="col">Reached through</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr>
              <td>
                <a [routerLink]="[...scoped.commands(), 'repositories', row.entry.repository]">{{
                  row.entry.repository
                }}</a>
              </td>
              <td class="subtle">{{ row.entry.archetype || none }}</td>
              <td class="num">{{ row.entry.depth }}</td>
              <!-- Empty for a repository that pins this one directly: there is nothing in between,
                   and an em dash says that better than repeating the subject's own name. -->
              <td class="subtle value">{{ row.via || none }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DownstreamTable {
  /** The project the address names, so every link out of this table stays inside it. */
  protected readonly scoped = injectScopedProject();

  readonly downstream = input.required<readonly DownstreamEntryDto[]>();

  readonly caption = input('');

  protected readonly none = NONE;

  protected readonly rows = computed<readonly DownstreamRow[]>(() =>
    this.downstream().map((entry) => ({
      key: entry.repository,
      entry,
      via: entry.via.join(' → '),
    })),
  );
}
