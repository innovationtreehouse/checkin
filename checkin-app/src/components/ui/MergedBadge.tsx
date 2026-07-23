"use client";

import { Badge } from "@mantine/core";

/**
 * Reused wherever a tombstoned (merged-away) Person can surface in an admin view —
 * one badge component, not a new "merge status" subsystem (ponytail).
 */
export function MergedBadge({ person }: { person: { mergedIntoId?: number | null } }) {
  if (person.mergedIntoId == null) return null;
  return <Badge color="gray">merged</Badge>;
}
