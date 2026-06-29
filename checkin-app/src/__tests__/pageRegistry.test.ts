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
