"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Center, Group, Loader, Stack, Table, Title } from '@mantine/core';
import { useRequireRole } from '@/hooks/useRequireRole';
import { formatDateTime } from '@/lib/time';

type BadgeEvent = {
  id: number;
  time: string;
  participant?: { name?: string; email?: string };
  location?: string;
};

export default function AdminBadgesPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin']);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<BadgeEvent[]>([]);
  const [message, setMessage] = useState("");

  const fetchBadges = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/badges');
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
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>Raw Badge Events</Title>
        <Button variant="default" onClick={() => router.push('/admin')}>← Admin Ops</Button>
      </Group>

      {message && (
        <Alert color={message.includes('success') ? 'green' : 'red'}>{message}</Alert>
      )}

      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Time</Table.Th>
              <Table.Th>Participant</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Location</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {badges.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>{b.id}</Table.Td>
                <Table.Td>{formatDateTime(b.time)}</Table.Td>
                <Table.Td>{b.participant?.name || "Unknown"}</Table.Td>
                <Table.Td>{b.participant?.email}</Table.Td>
                <Table.Td>{b.location || 'Front Door'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
