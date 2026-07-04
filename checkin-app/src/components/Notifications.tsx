"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button, Group } from "@mantine/core";
import { CountBadge } from "@/components/ui/CountBadge";

interface NotificationData {
  membership: { pendingReviews: number; blocked: number };
}

/**
 * In-app red-dot indicators, fed by GET /api/notifications. Today it surfaces the
 * membership domain (a reviewer's pending queue, the board's blocked applications);
 * other domains can be added as new sections as the API grows. Renders nothing when
 * there's nothing to show. Polls lightly so the dots stay current without a refresh.
 */
export default function Notifications() {
  const [data, setData] = useState<NotificationData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchCounts = () =>
      fetch("/api/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => { if (!cancelled && d) setData(d); })
        .catch(() => { /* silent — indicators are best-effort */ });
    fetchCounts();
    const t = setInterval(fetchCounts, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const m = data?.membership;
  if (!m || m.blocked === 0) return null;

  return (
    <Group gap="sm" wrap="wrap">
      {/* Reviewer's pending-review queue moved to the green /membership-ops nav+tab
          pill (reviewBadges → review.canActOn, branch claude/cool-chatelet-760f39):
          same count, same gate, an action-green surface in the right place. */}
      {m.blocked > 0 && (
        <Button
          component={Link}
          href="/membership-ops/applications"
          variant="light"
          color="red"
          rightSection={<CountBadge intent="alert">{m.blocked}</CountBadge>}
        >
          🚨 Blocked applications
        </Button>
      )}
    </Group>
  );
}
