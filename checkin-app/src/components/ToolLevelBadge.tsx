/**
 * ToolLevelBadge — the Innovation Treehouse tool-certification badge.
 *
 * The ONLY place the shop's regulated red/yellow/blue colors appear. These dot colors are
 * mandated by the "Shop Safety Rules & Certification Process" v1.6.1 and must NOT be restyled.
 * Everything else in the app uses the green/purple brand.
 *
 * `level` maps to the Prisma `ToolLevel` enum (see toToolLevel below).
 * Built on Mantine <Badge>. Drop into src/components/ and use where tool statuses are shown.
 */
import { Badge, type BadgeProps } from '@mantine/core';

export type ToolLevel =
  | 'none' | 'basic' | 'certified' | 'dof' | 'instructor' | 'certifier';

const LEVELS: Record<ToolLevel, { label: string; short: string; dot: string; bg: string; fg: string }> = {
  none:       { label: 'Uncertified',    short: 'Uncert.',    dot: '#aca3b8', bg: '#f3f1f6', fg: '#635c6e' },
  basic:      { label: 'Basic',          short: 'Basic',      dot: '#d2483f', bg: '#fbe2e0', fg: '#97271f' },
  certified:  { label: 'Certified',      short: 'Certified',  dot: '#5fa343', bg: '#ddeecf', fg: '#4a8334' },
  dof:        { label: 'DOF',            short: 'DOF',        dot: '#e0a32e', bg: '#fbf0d4', fg: '#a06d12' },
  instructor: { label: 'Instructor',     short: 'Instructor', dot: '#3f7fd2', bg: '#dceaf8', fg: '#245a9e' },
  certifier:  { label: 'Shop Certifier', short: 'Certifier',  dot: '#6e4a98', bg: '#e6d9f0', fg: '#4c3169' },
};

/**
 * Regulated dot color for a level — single source of truth for the Shop Safety colors.
 * Use this (not a local copy) when a status must be shown as a raw color, e.g. the
 * full-screen kiosk certification matrix cells where a labeled <Badge> doesn't fit.
 */
export const toolLevelDot = (level: ToolLevel): string => (LEVELS[level] ?? LEVELS.none).dot;

/** Full human label for a level (e.g. "Shop Certifier") — for tooltips/titles. */
export const toolLevelLabel = (level: ToolLevel): string => (LEVELS[level] ?? LEVELS.none).label;

/** Map a raw Prisma ToolLevel enum string (or null) to our key. */
export function toToolLevel(enumValue: string | null | undefined): ToolLevel {
  switch (enumValue) {
    case 'BASIC': return 'basic';
    case 'CERTIFIED': return 'certified';
    case 'DOF': return 'dof';
    case 'INSTRUCTOR': return 'instructor';
    case 'MAY_CERTIFY_OTHERS': return 'certifier';
    default: return 'none';
  }
}

export interface ToolLevelBadgeProps extends Omit<BadgeProps, 'color' | 'leftSection'> {
  level: ToolLevel;
  short?: boolean;
}

export function ToolLevelBadge({ level, short = false, ...rest }: ToolLevelBadgeProps) {
  const l = LEVELS[level] ?? LEVELS.none;
  return (
    <Badge
      variant="default"
      radius="xl"
      styles={{ root: { backgroundColor: l.bg, color: l.fg, border: 'none', fontWeight: 700 } }}
      leftSection={
        <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: l.dot }} />
      }
      {...rest}
    >
      {short ? l.short : l.label}
    </Badge>
  );
}
