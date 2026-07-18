"use client";

import { Badge, type BadgeProps } from '@mantine/core';

/**
 * Centralized role / certification badge. Replaces the per-page inline-styled badges that
 * were duplicated across the admin, shop, and household pages. Add new roles to ROLE_META.
 */
type RoleMeta = { label: string; color: string };

const ROLE_META: Record<string, RoleMeta> = {
  // Participant roles
  isSysadmin: { label: 'Sysadmin', color: 'red' },
  isBoardMember: { label: 'Board', color: 'grape' },
  isKeyholder: { label: 'Keyholder', color: 'blue' },
  isBackgroundCheckReviewer: { label: 'BG Reviewer', color: 'indigo' },
  isOperations: { label: 'Operations', color: 'teal' },
  coreVolunteer: { label: 'Core Volunteer', color: 'pink' },
  // Tool certification levels
  BASIC: { label: 'Basic', color: 'gray' },
  DOF: { label: 'DOF', color: 'yellow' },
  CERTIFIED: { label: 'Certified', color: 'blue' },
  INSTRUCTOR: { label: 'Instructor', color: 'green' },
  MAY_CERTIFY_OTHERS: { label: 'Certifier', color: 'green' },
};

/** The display label for a role/certification key — same lookup RoleBadge renders, for callers that need plain text (e.g. a confirm-modal delta summary). */
export function roleLabel(role: string): string {
  return ROLE_META[role]?.label ?? role;
}

export function RoleBadge({
  role,
  label,
  ...badgeProps
}: { role: string; label?: string } & Omit<BadgeProps, 'color' | 'children'>) {
  const meta = ROLE_META[role];
  return (
    <Badge color={meta?.color ?? 'gray'} variant="light" {...badgeProps}>
      {label ?? meta?.label ?? role}
    </Badge>
  );
}
