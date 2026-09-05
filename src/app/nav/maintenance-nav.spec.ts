import { provideLocationMocks } from '@angular/common/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { MaintenanceNav } from './maintenance-nav';

/** A destination for the router to land on, so a URL can be asserted without mounting a page. */
@Component({
  selector: 'app-nav-spec-blank',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class Blank {}

/**
 * The real route table is not used here on purpose: this spec is about the mapping between the URL
 * and the highlighted entry, and mounting the real pages would drag their reads in and assert them
 * by accident.
 */
const STUB_ROUTES: Routes = [{ path: '**', component: Blank }];

/**
 * The sub-navigation, which is the whole navigation of this app.
 *
 * One rule, asserted in both directions: the URL decides which entry is current — including for the
 * pages that are not entries of their own, a repository and a bump, which belong to Internal ›
 * Repositories, and including the two addresses that only ever exist for the instant before their
 * redirect lands.
 */
describe('MaintenanceNav', () => {
  let router: Router;
  let fixture: ComponentFixture<MaintenanceNav>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(STUB_ROUTES), provideLocationMocks()],
    });
    router = TestBed.inject(Router);
  });

  async function mountAt(url: string): Promise<void> {
    await router.navigateByUrl(url);
    fixture = TestBed.createComponent(MaintenanceNav);
    await fixture.whenStable();
  }

  /** The current entry, spelled as `<section> › <entry>` so the two Repositories are told apart. */
  function current(): string {
    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a.current');
    if (!link) {
      return '';
    }
    const headings = Array.from(element.querySelectorAll('.section'));
    const heading = headings.filter(
      (candidate) => candidate.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return `${heading[heading.length - 1]?.textContent?.trim()} › ${link.textContent?.trim()}`;
  }

  it('offers two inventory sections with the same two views in each, and the trains beside them', async () => {
    await mountAt('/');
    const element = fixture.nativeElement as HTMLElement;

    expect(
      Array.from(element.querySelectorAll('.section')).map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(['Internal', 'External', 'Releases']);
    expect(
      Array.from(element.querySelectorAll('a')).map((link) => link.getAttribute('href')),
    ).toEqual([
      '/internal',
      '/internal/dependencies',
      '/external',
      '/external/dependencies',
      '/trains',
    ]);
  });

  /** The bare root is on its way to the internal listing; the menu must not flicker on the way. */
  it('marks Internal › Repositories at the root and on the internal listing', async () => {
    await mountAt('/');
    expect(current()).toBe('Internal › Repositories');

    await mountAt('/internal');
    expect(current()).toBe('Internal › Repositories');
  });

  it('tells the two sections apart', async () => {
    await mountAt('/external');
    expect(current()).toBe('External › Repositories');

    await mountAt('/external/dependencies?name=io.quarkus:*');
    expect(current()).toBe('External › Dependencies');

    await mountAt('/internal/dependencies?ecosystem=npm&name=@qits/ui-components');
    expect(current()).toBe('Internal › Dependencies');
  });

  /**
   * A repository and a bump name no section — a repository page shows both halves of what it pins.
   * They still have to light something, and Internal › Repositories is where they were reached from.
   */
  it('keeps Internal › Repositories current inside a repository and inside a bump', async () => {
    await mountAt('/repositories/qits-ci');
    expect(current()).toBe('Internal › Repositories');

    await mountAt('/bumps/bump-1');
    expect(current()).toBe('Internal › Repositories');
  });

  /**
   * A journey and the by-release hop are not entries of their own: they match on the first segment
   * alone, so both stay lit on the listing they were reached from.
   */
  it('keeps Releases › Release trains current inside a journey and on the by-release hop', async () => {
    await mountAt('/trains');
    expect(current()).toBe('Releases › Release trains');

    await mountAt('/trains/t-1');
    expect(current()).toBe('Releases › Release trains');

    await mountAt('/trains/by-release/qits-eventstream/2026.905.1');
    expect(current()).toBe('Releases › Release trains');
  });

  /** The address the search had before there were two of them, before its redirect lands. */
  it('reads the legacy /dependencies as the internal view it redirects to', async () => {
    await mountAt('/dependencies');
    expect(current()).toBe('Internal › Dependencies');
  });

  /** A deep link renders before any NavigationEnd arrives, so the seed is what is asserted here. */
  it('follows a navigation made after it was mounted', async () => {
    await mountAt('/internal');
    await router.navigateByUrl('/external/dependencies');
    await fixture.whenStable();
    expect(current()).toBe('External › Dependencies');
  });
});
