import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Something that loaded and holds nothing, said in a sentence.
 *
 * It exists so that "this application has no entries" is never drawn as blank space — an empty table
 * that renders nothing is indistinguishable from one that failed silently, and here the two lead an
 * operator somewhere very different: a deployment with no configuration is a working deployment,
 * while a read that failed is a screen that must not be trusted.
 */
@Component({
  selector: 'app-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="empty">{{ message() }}</p>`,
  styles: `
    .empty {
      margin: 0.15rem 0;
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class Empty {
  readonly message = input.required<string>();
}
