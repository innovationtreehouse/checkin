import { readdirSync } from 'fs';
import { join } from 'path';
import { PAGES, REGISTRY_EXCLUDED } from '@/components/pageRegistry';
import { FACILITY_NAV_LINKS } from '@/lib/facilityNav';

// Walk src/app for every page.tsx and turn it into its route path, skipping
// dynamic segments ([id]) which the directory deliberately omits.
function routeOf(file: string): string | null {
  const rel = file.replace(/.*\/src\/app/, '').replace(/\/page\.tsx$/, '');
  if (rel.includes('[')) return null; // dynamic route — not directory-listable
  return rel === '' ? '/' : rel;
}

function findPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPages(full));
    else if (entry.name === 'page.tsx') out.push(full);
  }
  return out;
}

describe('pageRegistry drift guard', () => {
  const appDir = join(__dirname, '..', 'app');
  const routes = findPages(appDir).map(routeOf).filter((r): r is string => r !== null);
  const known = new Set([...PAGES.map((p) => p.href), ...REGISTRY_EXCLUDED]);

  it('lists or explicitly excludes every static route', () => {
    const missing = routes.filter((r) => !known.has(r));
    expect(missing).toEqual([]);
  });

  it('has no registry/exclude entries pointing at routes that no longer exist', () => {
    const live = new Set(routes);
    const stale = [...PAGES.map((p) => p.href), ...REGISTRY_EXCLUDED].filter((r) => !live.has(r));
    expect(stale).toEqual([]);
  });

  it('has no duplicate hrefs in the registry', () => {
    const hrefs = PAGES.map((p) => p.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });
});

// Operations reaches Facility Ops in aggregate only (#1633): Print ID Badges and
// Participation Trends. Each directory row must agree with the tab's own gate, or
// the directory advertises a page that ejects the viewer — the same fork #1569 is
// about, so the expectation is read off FACILITY_NAV_LINKS rather than retyped.
describe('Facility Ops directory agrees with the section gates', () => {
  const ops = { isOperations: true };
  const entryFor = (href: string) => PAGES.find((p) => p.href === href)!;

  it.each(FACILITY_NAV_LINKS)('$href is listed to operations iff its page admits them', ({ href, roles }) => {
    expect(entryFor(href).visible(ops, true, null)).toBe(roles.includes('isOperations'));
  });

  it('hides the /facility-ops index from operations (it redirects into Visits)', () => {
    expect(entryFor('/facility-ops').visible(ops, true, null)).toBe(false);
  });

  it('still shows every Facility Ops entry to a board member', () => {
    const board = { isBoardMember: true };
    for (const p of PAGES.filter((p) => p.section === 'Facility Ops')) {
      expect(p.visible(board, true, null)).toBe(true);
    }
  });
});
