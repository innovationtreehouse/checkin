"use client";

import { useState, useEffect, useCallback } from 'react';
import { Center, Loader, Stack } from '@mantine/core';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { formatDateTime } from '@/lib/time';

type BadgeEvent = {
  id: number;
  time: string;
  participant?: { name?: string; email?: string };
  location?: string;
};

const COLUMNS: DataTableColumn<BadgeEvent>[] = [
  { header: 'ID', render: (b) => b.id, sortBy: (b) => b.id },
  { header: 'Time', render: (b) => formatDateTime(b.time), sortBy: (b) => b.time },
  { header: 'Participant', render: (b) => b.participant?.name || 'Unknown', sortBy: (b) => b.participant?.name },
  { header: 'Email', render: (b) => b.participant?.email, sortBy: (b) => b.participant?.email },
  { header: 'Location', render: (b) => b.location || 'Front Door', sortBy: (b) => b.location },
];

export default function AdminBadgesPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin']);

  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<BadgeEvent[]>([]);
  const [message, setMessage] = useState("");

  const fetchBadges = useCallback(async () => {
    try {
      const res = await fetch('/api/facility/badges');
      if (res.ok) {
        const data = await res.json();
        setBadges(data.badges);
      } else {
        setMessage("Failed to load badge events.");
      }
    } catch {
      setMessage("Network error loading badges.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchBadges();
  }, [ready, fetchBadges]);

  if (authLoading || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  return (
    <Stack>
      <AlertBanner message={message} tone={message.includes('success') ? 'success' : 'error'} />

      <DataTable columns={COLUMNS} rows={badges} getRowKey={(b) => b.id} emptyMessage="No badge events." />
    </Stack>
  );
}
