import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DependentDto } from '../api/dto';
import { injectScopedProject } from '../nav/scoped-project';
import { formatInstant, formatRelative } from '../ui/format';
import { StatusBadge } from '../ui/status-badge';

/** One dependent, with the two things the table works out rather than reads. */
interface DependentRow {
  readonly key: string;
  readonly dependent: DependentDto;
  /** CURRENT, BEHIND or UNKNOWN — see `currencyOf`. */
  readonly currency: string;
}

/**
 * Which of them ship the newest version of the subject.
 *
 * <p><b>Equality is the only version comparison this application is allowed to make, and this is
 * it.</b> Ordering is the service's word everywhere else — maven, npm and OCI tags order
 * differently — but "is this the same string as the newest" needs no ordering at all. It is also
 * why the answer for a difference is BEHIND at a warning tone rather than a failure: a release that
 * is merely *not the newest* may be perfectly deliberate.
 *
 * <p>UNKNOWN when nothing knows what the newest is. Silence must not render as success.
 */
function currencyOf(embedded: string, subjectLatest: string | null): string {
  if (!subjectLatest) {
    return 'UNKNOWN';
  }
  return embedded === subjectLatest ? 'CURRENT' : 'BEHIND';
}

/**
 * What consumes something: every artifact of ours whose newest release contains it.
 *
 * <p><b>This is the pins table read backwards, and it is the question a release leaves behind.</b>
 * A pin says what a repository asked for; this says who is already carrying what it published — and
 * unlike a pin, it is read off bills of materials of things that were actually built, so a
 * repository that never released is honestly absent from it rather than assumed innocent.
 *
 * <p>Nothing here is editable and nothing here is polled: a release is a fact that happened, and it
 * does not move while it is being read.
 */
@Component({
  selector: 'app-dependents-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadge],
  styleUrls: ['../ui/page.css', './dependents-table.css'],
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
            <th scope="col">Dependent repository</th>
            @if (showArtifact()) {
              <th scope="col">Artifact</th>
            }
            <th scope="col">Version used</th>
            <th scope="col">Scope</th>
            <th scope="col">Built</th>
            <th scope="col">Up to date</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr>
              <td>
                <a
                  [routerLink]="[...scoped.commands(), 'repositories', row.dependent.repository]"
                  >{{ row.dependent.repository }}</a
                >
              </td>
              @if (showArtifact()) {
                <td class="mono value">
                  {{ row.dependent.artifactName }}
                  <span class="subtle">{{ row.dependent.artifactEcosystem }}</span>
                </td>
              }
              <td class="mono">{{ row.dependent.embeddedVersion }}</td>
              <td>
                @if (row.dependent.direct) {
                  direct
                } @else {
                  <!-- The row says only that the subject is somewhere in this artifact's tree; it
                       does not say through what, so neither does this cell. -->
                  <span class="transitive">transitive</span>
                }
              </td>
              <td [attr.title]="instant(row.dependent.occurredAt)" class="subtle">
                {{ ago(row.dependent.occurredAt) }}
              </td>
              <td><app-status-badge [status]="row.currency" /></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DependentsTable {
  /** The project the address names, so every link out of this table stays inside it. */
  protected readonly scoped = injectScopedProject();

  readonly dependents = input.required<readonly DependentDto[]>();

  /**
   * The newest version of the subject, against which "up to date" is decided.
   *
   * Null where the caller has several subjects in one table, or where no registry ever answered —
   * both of which render UNKNOWN rather than a guess.
   */
  readonly subjectLatest = input<string | null>(null);

  /** Whether to name the artifact on each row — for a table whose rows are about several. */
  readonly showArtifact = input(false);

  readonly caption = input('');

  /** The clock the "built" column is drawn against; a minute's resolution needs no more. */
  readonly now = input.required<number>();

  protected readonly rows = computed<readonly DependentRow[]>(() => {
    const latest = this.subjectLatest();
    return this.dependents().map((dependent) => ({
      key: `${dependent.artifactEcosystem}|${dependent.artifactName}|${dependent.artifactVersion}|${dependent.repository}`,
      dependent,
      currency: currencyOf(dependent.embeddedVersion, latest),
    }));
  });

  protected instant(iso: string | null): string {
    return formatInstant(iso);
  }

  protected ago(iso: string | null): string {
    return formatRelative(iso, this.now());
  }
}
