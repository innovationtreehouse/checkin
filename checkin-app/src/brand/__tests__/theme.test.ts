import { readFileSync } from 'fs';
import { join } from 'path';
import { brand } from '@/brand';
import { treehouseBrand } from '@/brand/treehouse';
import { baseTheme } from '@/brand/base';

/**
 * Guards for the Innovation Treehouse brand theme. The brand theme is built by spreading
 * baseTheme into a single createTheme() call (see treehouse.ts). It used to use Mantine's
 * mergeThemeOverrides(), but that is a client-only export and threw "Attempted to call
 * mergeThemeOverrides() from the server" during server-component module evaluation (every
 * page 500'd). These tests pin both the composition equivalence and that the client-only
 * call never comes back.
 */
describe('treehouse brand theme', () => {
  const theme = treehouseBrand.theme;

  it('is the default brand (Treehouse is never dropped)', () => {
    expect(brand.id).toBe('treehouse');
    expect(brand.appName).toBe('CheckMeIn');
    expect(brand.logo?.alt).toBe('Innovation Treehouse');
  });

  it('applies the brand palette', () => {
    expect(theme.primaryColor).toBe('treehouseGreen');
    expect(theme.colors?.treehouseGreen?.[6]).toBe('#78b858');
    expect(theme.colors?.treehousePurple?.[6]).toBe('#6e4a98');
    expect(theme.primaryShade).toEqual({ light: 6, dark: 5 });
  });

  it('references the brand font CSS variables in the right slots', () => {
    expect(theme.fontFamily).toContain('var(--font-nunito)');
    expect(theme.fontFamilyMonospace).toContain('var(--font-space-mono)');
    expect(theme.headings?.fontFamily).toContain('var(--font-hnkani)');
  });

  it('inherits the base theme (shape scale) when folded into createTheme', () => {
    // defaultRadius/radius come only from baseTheme — if the spread is dropped these vanish.
    expect(theme.defaultRadius).toBe(baseTheme.defaultRadius);
    expect(theme.radius).toEqual(baseTheme.radius);
  });

  it('deep-merges components: base defaults AND the brand Title rule both survive', () => {
    // The manual merge must keep baseTheme's component defaults (Button/Card/…) alongside
    // the brand-only Title rule. A shallow overwrite of `components` would drop the base set.
    expect(theme.components?.Button).toEqual(baseTheme.components?.Button);
    expect(theme.components?.Card).toEqual(baseTheme.components?.Card);
    expect(theme.components?.Title?.styles).toEqual({ root: { textTransform: 'lowercase' } });
  });

  it('builds the theme without the client-only mergeThemeOverrides (server-component safe)', () => {
    const code = readFileSync(join(__dirname, '..', 'treehouse.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments (the note that explains this rule)
      .replace(/\/\/.*$/gm, ''); // strip line comments
    expect(code).not.toMatch(/mergeThemeOverrides/);
  });
});
