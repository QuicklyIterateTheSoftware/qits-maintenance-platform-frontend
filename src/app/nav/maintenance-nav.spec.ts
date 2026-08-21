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
 * pages that are not entries of their own, a repository and a bump, which belong to Repositories.
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

  function current(): string {
    const element = fixture.nativeElement as HTMLElement;
    return element.querySelector('a.current')?.textContent?.trim() ?? '';
  }

  it('offers the two views of the inventory', async () => {
    await mountAt('/');
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll('a');
    expect(Array.from(links).map((link) => link.textContent?.trim())).toEqual([
      'Repositories',
      'Dependencies',
    ]);
  });

  it('marks Repositories on the overview', async () => {
    await mountAt('/');
    expect(current()).toBe('Repositories');
  });

  /** A repository and a bump are reached from the overview, and read as being under it. */
  it('keeps Repositories current inside a repository and inside a bump', async () => {
    await mountAt('/repositories/qits-ci');
    expect(current()).toBe('Repositories');

    await mountAt('/bumps/bump-1');
    expect(current()).toBe('Repositories');
  });

  it('marks Dependencies on the search, query parameters and all', async () => {
    await mountAt('/dependencies?name=@qits/*');
    expect(current()).toBe('Dependencies');
  });

  /** A deep link renders before any NavigationEnd arrives, so the seed is what is asserted here. */
  it('follows a navigation made after it was mounted', async () => {
    await mountAt('/');
    await router.navigateByUrl('/dependencies');
    await fixture.whenStable();
    expect(current()).toBe('Dependencies');
  });
});
