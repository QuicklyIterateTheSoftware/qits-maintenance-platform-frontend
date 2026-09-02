import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { PinDto, TransitiveDto } from '../api/dto';
import { Empty } from '../ui/empty';
import { NONE } from '../ui/format';

/** The key the root disclosure is held under — a name no manifest path can collide with. */
const ROOT = '(root)';

/** Nothing to expand, shared rather than allocated per row. */
const NO_CHILDREN: readonly TransitiveDto[] = [];

/** One pin, with whatever its released artifacts dragged in behind it. */
interface PinRow {
  /** Stable per row: two manifests may pin the same name at the same version. */
  readonly key: string;
  readonly pin: PinDto;
  readonly children: readonly TransitiveDto[];
  readonly expanded: boolean;
}

/**
 * A repository's pins as a table, with what they contain folded underneath them.
 *
 * <p>One component and several instances, because the repository page draws the same table three
 * times — internal, external, and the pins nothing can ever move — and the differences between them
 * are which rows go in, not how a row looks.
 *
 * <p><b>A transitive is drawn as a lesser row on purpose.</b> Grey, indented under the direct
 * dependency that pulled it in, and never in the amber a pending pin gets: there is no line to
 * edit, no group and no bump, so a reader must not be able to mistake one for work they can do.
 * "newer available" is the strongest thing said about one, and it is said in grey.
 *
 * <p><b>Collapsed by default, and expanded row by row.</b> A released artifact contains hundreds of
 * components and a handful of pins; opening every subtree would bury the table this page is for.
 * The expansion set is keyed by the pin's row rather than by its name, so the same dependency
 * pinned in two manifests opens independently — both then show the same children, which is true:
 * `via` names a component, not a manifest line.
 *
 * <p>Transitives whose `via` matches no pin here — and those the artifact's own root names — go
 * under one disclosure at the end rather than being dropped. They are the ones an advisory is most
 * likely to be about, and a component that appears nowhere is worse than one that appears last.
 */
@Component({
  selector: 'app-pins-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Empty],
  styleUrls: ['../ui/page.css', './pins-table.css'],
  template: `
    @if (heading()) {
      <h2>{{ heading() }}</h2>
    }
    @if (rows().length === 0 && roots().length === 0) {
      <app-empty [message]="emptyMessage()" />
    } @else {
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
              <th scope="col">Manifest</th>
              <th scope="col">Ecosystem</th>
              <th scope="col">Dependency</th>
              <th scope="col">Version</th>
              <th scope="col">Latest</th>
              <th scope="col">Kind</th>
              <th scope="col">Group</th>
              <th scope="col">Location</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr [class.row-pending]="row.pin.pending">
                <td class="mono">
                  @if (row.children.length > 0) {
                    <button
                      type="button"
                      class="chevron"
                      [attr.aria-expanded]="row.expanded"
                      [attr.aria-label]="
                        (row.expanded ? 'Hide the ' : 'Show the ') +
                        row.children.length +
                        ' components inside ' +
                        row.pin.name
                      "
                      (click)="toggle(row.key)"
                    >
                      {{ row.expanded ? '▾' : '▸' }}
                    </button>
                  }
                  {{ row.pin.manifestPath }}
                </td>
                <td>{{ row.pin.ecosystem }}</td>
                <td class="mono value">{{ row.pin.name }}</td>
                <td class="mono" [attr.title]="row.pin.range">{{ row.pin.version }}</td>
                <td class="mono">
                  {{ row.pin.latest || none }}
                  <!-- A registry that could not be reached leaves a null latest and a false
                       pending, which on its own is indistinguishable from being up to date. -->
                  @if (row.pin.latestError) {
                    <span class="lookup-error" [attr.title]="row.pin.latestError"
                      >lookup failed</span
                    >
                  }
                </td>
                <td>{{ row.pin.kind }}</td>
                <td class="mono">{{ row.pin.group }}</td>
                <td class="mono subtle">{{ row.pin.location }}</td>
              </tr>
              @if (row.expanded) {
                @for (
                  child of row.children;
                  track child.ecosystem + '|' + child.name + '|' + child.version
                ) {
                  <tr class="row-transitive">
                    <td class="indent" aria-hidden="true">↳</td>
                    <td>{{ child.ecosystem || none }}</td>
                    <td class="mono value">{{ child.name }}</td>
                    <td class="mono">{{ child.version }}</td>
                    <td>{{ child.behind ? 'newer available' : none }}</td>
                    <td>transitive</td>
                    <td>{{ none }}</td>
                    <td>{{ none }}</td>
                  </tr>
                }
              }
            }
            @if (roots().length > 0) {
              <tr class="row-roots">
                <td colspan="8">
                  <button
                    type="button"
                    class="chevron"
                    [attr.aria-expanded]="rootExpanded()"
                    [attr.aria-label]="
                      (rootExpanded() ? 'Hide the ' : 'Show the ') +
                      roots().length +
                      ' components under no pin on this page'
                    "
                    (click)="toggle(root)"
                  >
                    {{ rootExpanded() ? '▾' : '▸' }}
                  </button>
                  <span class="subtle"
                    >(root) — {{ roots().length }} contained by this repository’s artifacts, under
                    no pin here</span
                  >
                </td>
              </tr>
              @if (rootExpanded()) {
                @for (
                  child of roots();
                  track child.ecosystem + '|' + child.name + '|' + child.version
                ) {
                  <tr class="row-transitive">
                    <td class="indent" aria-hidden="true">↳</td>
                    <td>{{ child.ecosystem || none }}</td>
                    <td class="mono value">{{ child.name }}</td>
                    <td class="mono">{{ child.version }}</td>
                    <td>{{ child.behind ? 'newer available' : none }}</td>
                    <td>transitive</td>
                    <td>{{ none }}</td>
                    <td>{{ none }}</td>
                  </tr>
                }
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class PinsTable {
  /** The heading above the table, or nothing when the caller draws its own. */
  readonly heading = input('');

  readonly pins = input.required<readonly PinDto[]>();

  /** What the repository's artifacts contain, for the pins in this table and nothing else. */
  readonly transitives = input<readonly TransitiveDto[]>([]);

  /** The sentence for a table with no rows at all — never blank space. */
  readonly emptyMessage = input('No pins of this kind were read here.');

  readonly caption = input('');

  protected readonly none = NONE;
  protected readonly root = ROOT;

  /** Which subtrees are open, by row key. Collapsed is the state a reader arrives in. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set<string>());

  /** The transitives that hang under a direct component, keyed by that component's name. */
  private readonly byVia = computed(() => {
    const map = new Map<string, TransitiveDto[]>();
    for (const transitive of this.transitives()) {
      if (!transitive.via) {
        continue;
      }
      const under = map.get(transitive.via);
      if (under) {
        under.push(transitive);
      } else {
        map.set(transitive.via, [transitive]);
      }
    }
    return map;
  });

  protected readonly rows = computed<readonly PinRow[]>(() => {
    const byVia = this.byVia();
    const expanded = this.expanded();
    return this.pins().map((pin) => {
      const key = `${pin.manifestPath}|${pin.name}|${pin.location}`;
      return {
        key,
        pin,
        children: byVia.get(pin.name) ?? NO_CHILDREN,
        expanded: expanded.has(key),
      };
    });
  });

  /** What no pin in this table accounts for: the artifact's own root, and anything unmatched. */
  protected readonly roots = computed<readonly TransitiveDto[]>(() => {
    const names = new Set(this.pins().map((pin) => pin.name));
    return this.transitives().filter((transitive) => !transitive.via || !names.has(transitive.via));
  });

  protected readonly rootExpanded = computed(() => this.expanded().has(ROOT));

  /**
   * Open or close one subtree.
   *
   * A new `Set` rather than a mutation: the signal holds the set itself, and mutating it in place
   * would leave every computed above reading the same reference and never recomputing.
   */
  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.expanded.set(next);
  }
}
