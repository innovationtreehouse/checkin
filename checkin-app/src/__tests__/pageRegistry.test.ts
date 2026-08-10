import { readdirSync } from 'fs';
import { join } from 'path';
import { PAGES, REGISTRY_EXCLUDED } from '@/components/pageRegistry';

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

// Operations reaches the four Facility Ops tools (and the index, which redirects
// into Visits), so they must appear in the directory rather than being URL-only.
// Corrections is the exception: its page gate stays board/sysadmin, so listing it
// for operations would advertise a tab that ejects them — see #1476.
describe('Facility Ops visibility for operations', () => {
  const ops = { isOperations: true };
  const entryFor = (href: string) => PAGES.find((p) => p.href === href)!;

  it.each([
    '/facility-ops',
    '/facility-ops/badges',
    '/facility-ops/print-badges',
    '/facility-ops/trends',
    '/facility-ops/visits',
  ])('shows %s to an operations user', (href) => {
    expect(entryFor(href).visible(ops, true, null)).toBe(true);
  });

  it('hides /facility-ops/corrections from an operations user (page gate is still board-only)', () => {
    expect(entryFor('/facility-ops/corrections').visible(ops, true, null)).toBe(false);
  });

  it('still shows every Facility Ops entry to a board member', () => {
    const board = { isBoardMember: true };
    for (const p of PAGES.filter((p) => p.section === 'Facility Ops')) {
      expect(p.visible(board, true, null)).toBe(true);
    }
  });
});
