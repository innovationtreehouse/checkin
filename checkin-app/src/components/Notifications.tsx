"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge, Button, Group } from "@mantine/core";

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
  if (!m || (m.pendingReviews === 0 && m.blocked === 0)) return null;

  return (
    <Group gap="sm" wrap="wrap">
      {m.pendingReviews > 0 && (
        <Button
          component={Link}
          href="/membership-ops/review"
          variant="light"
          color="grape"
          rightSection={<Badge color="grape" circle>{m.pendingReviews}</Badge>}
        >
          🔍 Background-check reviews
        </Button>
      )}
      {m.blocked > 0 && (
        <Button
          component={Link}
          href="/membership-ops/applications"
          variant="light"
          color="red"
          rightSection={<Badge color="red" circle>{m.blocked}</Badge>}
        >
          🚨 Blocked applications
        </Button>
      )}
    </Group>
  );
}
