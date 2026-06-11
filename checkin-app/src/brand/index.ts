import type { Brand } from './types';
import { baseBrand } from './base';
import { treehouseBrand } from './treehouse';

const BRANDS: Record<string, Brand> = {
  base: baseBrand,
  treehouse: treehouseBrand,
};

/**
 * Default brand. NOTE: Innovation Treehouse is the active brand out of the box and is never
 * dropped — `base` (the unbranded app) is an explicit opt-out, not the fallback. Any
 * unset / empty / unknown NEXT_PUBLIC_BRAND resolves to Treehouse.
 */
const DEFAULT_BRAND = treehouseBrand;

/**
 * The active brand, selected at runtime via NEXT_PUBLIC_BRAND (same image, different brand
 * per deploy — like CHECKIN_ENV). Treehouse is the default; set NEXT_PUBLIC_BRAND=base for the
 * unbranded look. Add an org by adding a Brand to BRANDS — no page/component changes needed.
 */
export const brand: Brand = BRANDS[process.env.NEXT_PUBLIC_BRAND || 'treehouse'] ?? DEFAULT_BRAND;

export type { Brand } from './types';
