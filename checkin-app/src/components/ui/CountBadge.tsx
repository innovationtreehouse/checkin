"use client";

import { Badge, type BadgeProps } from '@mantine/core';

/**
 * Centralized numeric count badge. The three intent looks below were previously
 * hand-repeated across AppFrame, the section layouts, TodoCard, and Notifications
 * (see docs/designs/BADGE_AUDIT.md); routing them through here keeps them matched.
 *
 * - action = treehouseGreen fill + black text (needs-attention counts)
 * - info   = gray.2 fill + gray-8 text (informational counts; solid gray so it
 *            stays light on the dark sidebar where a translucent tint reads dark)
 * - alert  = red fill + white text (blocking counts)
 *
 * All default to size="md" and Mantine's default pill shape. Pass `size`,
 * `leftSection`, `aria-label`, or any other BadgeProps through as needed.
 */
const INTENT: Record<'action' | 'info' | 'alert', { color: string; c: string }> = {
  action: { color: 'treehouseGreen', c: 'var(--mantine-color-black)' },
  info: { color: 'gray.2', c: 'var(--mantine-color-gray-8)' },
  alert: { color: 'red', c: 'var(--mantine-color-white)' },
};

export function CountBadge({
  intent,
  size = 'md',
  ...badgeProps
}: { intent: 'action' | 'info' | 'alert' } & Omit<BadgeProps, 'color' | 'variant' | 'c'>) {
  const { color, c } = INTENT[intent];
  return <Badge size={size} color={color} variant="filled" c={c} {...badgeProps} />;
}
