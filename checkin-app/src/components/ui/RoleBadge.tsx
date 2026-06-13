"use client";

import { Badge, type BadgeProps } from '@mantine/core';

/**
 * Centralized role / certification badge. Replaces the per-page inline-styled badges that
 * were duplicated across the admin, shop, and household pages. Add new roles to ROLE_META.
 */
type RoleMeta = { label: string; color: string };

const ROLE_META: Record<string, RoleMeta> = {
  // Participant roles
  sysadmin: { label: 'Sysadmin', color: 'red' },
  boardMember: { label: 'Board', color: 'grape' },
  keyholder: { label: 'Keyholder', color: 'blue' },
  backgroundCheckReviewer: { label: 'BG Reviewer', color: 'indigo' },
  coreVolunteer: { label: 'Core Volunteer', color: 'pink' },
  // Tool certification levels
  BASIC: { label: 'Basic', color: 'gray' },
  DOF: { label: 'DOF', color: 'yellow' },
  CERTIFIED: { label: 'Certified', color: 'blue' },
  INSTRUCTOR: { label: 'Instructor', color: 'green' },
  MAY_CERTIFY_OTHERS: { label: 'Certifier', color: 'green' },
};

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
