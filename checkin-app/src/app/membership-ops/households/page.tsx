"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { Button, Center, Group, List, Loader, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { AdminEditHouseholdModal } from '@/components/admin/AdminEditHouseholdModal';

type Household = {
  id: number;
  name?: string | null;
  membership?: { status: string } | null;
  participants?: { id: number; name?: string | null; email?: string | null; boardMember?: boolean }[] | null;
};

export default function AdminHouseholdsPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember']);
  const router = useRouter();

  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editHouseholdId, setEditHouseholdId] = useState<number | null>(null);

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
    if (ready) fetchHouseholds();
  }, [ready, fetchHouseholds]);

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

  // Deny blocks login for every member of the household; restore (deny=false) returns it
  // to NONE so they can log in again with no privileges. Separate from grant/revoke.
  const setDenied = async (householdId: number, deny: boolean) => {
    if (deny && !window.confirm(
      'Deny membership for this household? Every member will be unable to log in.'
    )) {
      return;
    }
    try {
      const res = await fetch('/api/admin/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId, deny })
      });

      if (res.ok) {
        fetchHouseholds();
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: 'red', message: data.error || 'Failed to update membership.' });
      }
    } catch {
      notifications.show({ color: 'red', message: 'Network error.' });
    }
  };

  if (authLoading || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) {
    return null;
  }

  return (
    <Stack>
      <AdminPageHeader title="Manage Memberships" />

      <Text c="dimmed">
        View all households and toggle their official facility Membership status. Memberships grant
        shop access and other organizational privileges. Denying membership blocks login for every
        member of the household — a household containing a board member must have that role removed first.
      </Text>

      <AlertBanner message={error} tone="error" />

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
              const status = household.membership?.status;
              const hasActiveMembership = status === "ACTIVE";
              const isDenied = status === "DENIED";
              const hasBoardMember = household.participants?.some((p) => p.boardMember) ?? false;

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
                    {isDenied ? (
                      <Text c="red" fw={700}>Denied</Text>
                    ) : hasActiveMembership ? (
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
                        onClick={() => setEditHouseholdId(household.id)}
                      >
                        Edit Info
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => router.push(`/membership-ops/participants/new?householdId=${household.id}`)}
                      >
                        + Add Participant
                      </Button>
                      {isDenied ? (
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          onClick={() => setDenied(household.id, false)}
                        >
                          Restore Access
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="light"
                            color={hasActiveMembership ? 'red' : 'green'}
                            onClick={() => toggleMembership(household.id, hasActiveMembership)}
                          >
                            {hasActiveMembership ? "Revoke Membership" : "Grant Membership"}
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            color="red"
                            disabled={hasBoardMember}
                            title={hasBoardMember ? "Remove the board role before denying membership" : undefined}
                            onClick={() => setDenied(household.id, true)}
                          >
                            Deny Membership
                          </Button>
                        </>
                      )}
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

      <AdminEditHouseholdModal
        householdId={editHouseholdId}
        opened={editHouseholdId !== null}
        onClose={() => setEditHouseholdId(null)}
        onSaved={() => fetchHouseholds()}
      />
    </Stack>
  );
}
