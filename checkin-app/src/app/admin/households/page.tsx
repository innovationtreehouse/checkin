"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Center, Group, List, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';

type Household = {
  id: number;
  name?: string | null;
  membership?: { status: string } | null;
  participants?: { id: number; name?: string | null; email?: string | null }[] | null;
};

export default function AdminHouseholdsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchHouseholds = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/households');
      if (res.ok) {
        const data = await res.json();
        setHouseholds(data.households);
      } else {
        setError("Failed to fetch households.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      const isAuthorized = session?.user?.sysadmin || session?.user?.boardMember;
      if (!isAuthorized) {
        router.push('/');
      } else {
        fetchHouseholds();
      }
    }
  }, [status, session, router, fetchHouseholds]);

  const toggleMembership = async (householdId: number, currentActive: boolean) => {
    try {
      const res = await fetch('/api/admin/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId, active: !currentActive })
      });

      if (res.ok) {
        fetchHouseholds();
      } else {
        notifications.show({ color: 'red', message: 'Failed to update membership.' });
      }
    } catch {
      notifications.show({ color: 'red', message: 'Network error.' });
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session || (!session.user?.sysadmin && !session.user?.boardMember)) {
    return null;
  }

  return (
    <Stack>
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>Manage Memberships</Title>
        <Button component={Link} href="/admin" variant="default">← Admin Hub</Button>
      </Group>

      <Text c="dimmed">
        View all households and toggle their official facility Membership status. Memberships grant
        shop access and other organizational privileges.
      </Text>

      {error && <Alert color="red">{error}</Alert>}

      <Table.ScrollContainer minWidth={600}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Household</Table.Th>
              <Table.Th>Participants</Table.Th>
              <Table.Th>Is Member?</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {households.map((household) => {
              const hasActiveMembership = household.membership?.status === "ACTIVE";

              return (
                <Table.Tr key={household.id}>
                  <Table.Td>
                    <Text fw={600}>{household.name || `Household #${household.id}`}</Text>
                  </Table.Td>
                  <Table.Td>
                    {household.participants && household.participants.length > 0 ? (
                      <List size="sm">
                        {household.participants.map((p) => (
                          <List.Item key={p.id}>{p.name || p.email}</List.Item>
                        ))}
                      </List>
                    ) : (
                      <Text size="sm" c="dimmed" fs="italic">Empty</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {hasActiveMembership ? (
                      <Text c="green" fw={700}>Yes</Text>
                    ) : (
                      <Text c="dimmed">No</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => router.push(`/admin/participants/new?householdId=${household.id}`)}
                      >
                        + Add Participant
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color={hasActiveMembership ? 'red' : 'green'}
                        onClick={() => toggleMembership(household.id, hasActiveMembership)}
                      >
                        {hasActiveMembership ? "Revoke Membership" : "Grant Membership"}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}

            {households.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4} ta="center">
                  <Text c="dimmed" py="md">No households found.</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
