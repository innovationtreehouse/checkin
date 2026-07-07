"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireRole } from '@/hooks/useRequireRole';
import { Badge, Button, Group, List, Modal, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { AdminEditHouseholdModal } from '@/components/admin/AdminEditHouseholdModal';
import { sharesHousehold } from '@/lib/conflictOfInterest';

import { PageLoader } from "@/components/ui/PageLoader";
type Household = {
  id: number;
  name?: string | null;
  orgMembership?: { status: string } | null;
  householdMembers?: { id: number; name?: string | null; email?: string | null; isBoardMember?: boolean; emailUndeliverableAt?: string | null }[] | null;
};

export default function AdminHouseholdsPage() {
  const { user: me, ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);
  const router = useRouter();

  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editHouseholdId, setEditHouseholdId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [confirmDenyOpened, { open: openConfirmDeny, close: closeConfirmDeny }] = useDisclosure(false);
  const [pendingDenyHouseholdId, setPendingDenyHouseholdId] = useState<number | null>(null);

  const fetchHouseholds = useCallback(async () => {
    try {
      const res = await fetch('/api/membership-ops/households');
      if (res.ok) {
        const data = await res.json();
        setHouseholds(data.households);
      } else {
        setError("Failed to fetch households.");
      }
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchHouseholds();
  }, [ready, fetchHouseholds]);

  const toggleMembership = async (householdId: number, currentActive: boolean) => {
    try {
      const res = await fetch('/api/membership-ops/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId, active: !currentActive })
      });

      if (res.ok) {
        fetchHouseholds();
        notifications.show({ color: 'green', message: currentActive ? 'Membership revoked.' : 'Membership granted.' });
      } else {
        notifications.show({ color: 'red', message: 'Failed to update membership.', autoClose: false });
      }
    } catch {
      notifications.show({ color: 'red', message: 'Network error.', autoClose: false });
    }
  };

  // Deny blocks login for every member of the household; restore (deny=false) returns it
  // to NONE so they can log in again with no privileges. Separate from grant/revoke.
  const setDenied = async (householdId: number, deny: boolean) => {
    if (deny) {
      setPendingDenyHouseholdId(householdId);
      openConfirmDeny();
      return;
    }
    await doSetDenied(householdId, false);
  };

  const doSetDenied = async (householdId: number, deny: boolean) => {
    try {
      const res = await fetch('/api/membership-ops/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId, deny })
      });

      if (res.ok) {
        fetchHouseholds();
        notifications.show({ color: 'green', message: deny ? 'Membership denied — members can no longer log in.' : 'Membership restored.' });
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: 'red', message: data.error || 'Failed to update membership.', autoClose: false });
      }
    } catch {
      notifications.show({ color: 'red', message: 'Network error.', autoClose: false });
    }
  };

  const confirmDeny = async () => {
    if (pendingDenyHouseholdId === null) return;
    closeConfirmDeny();
    const householdId = pendingDenyHouseholdId;
    setPendingDenyHouseholdId(null);
    await doSetDenied(householdId, true);
  };

  if (authLoading || loading) {
    return <PageLoader />;
  }

  if (!ready) {
    return null;
  }

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? households.filter((h) =>
        (h.name || `Household #${h.id}`).toLowerCase().includes(q) ||
        (h.householdMembers?.some((p) =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.email || '').toLowerCase().includes(q)
        ) ?? false)
      )
    : households;

  return (
    <Stack>
      <Text c="dimmed">
        View all households and toggle their official facility Membership status. Memberships grant
        shop access and other organizational privileges. Denying membership blocks login for every
        member of the household — a household containing a board member must have that role removed first.
      </Text>

      <AlertBanner message={error} tone="error" />

      <TextInput
        placeholder="Filter by household or participant name/email"
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
        maw={400}
      />

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
            {filtered.map((household) => {
              const status = household.orgMembership?.status;
              const hasActiveMembership = status === "ACTIVE";
              const isDenied = status === "DENIED";
              const hasBoardMember = household.householdMembers?.some((p) => p.isBoardMember) ?? false;
              // Conflict of interest: a board member may not GRANT their own household
              // membership (bypasses payment + background check). Sysadmin keeps the button.
              // Mirrors the server guard; disabled state is UX only. Revoke stays allowed.
              const ownGrantBlocked =
                !hasActiveMembership && me?.isSysadmin !== true && sharesHousehold(me?.householdId, household.id);
              const hasBrokenEmail = household.householdMembers?.some((p) => p.emailUndeliverableAt) ?? false;

              return (
                <Table.Tr key={household.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text
                        fw={600}
                        c="blue"
                        style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/membership-ops/households/${household.id}`)}
                      >
                        {household.name || `Household #${household.id}`}
                      </Text>
                      {hasBrokenEmail && (
                        <Tooltip label="A member's email is undeliverable — update their address">
                          <Badge color="red" variant="filled" size="sm" style={{ cursor: "default" }}>
                            ✉ Broken email
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {household.householdMembers && household.householdMembers.length > 0 ? (
                      <List size="sm">
                        {household.householdMembers.map((p) => (
                          <List.Item key={p.id}>
                            {p.name || p.email}
                            {p.emailUndeliverableAt && (
                              <Tooltip label="This email bounced or was marked spam — undeliverable">
                                <Text span c="red" fw={700} ml={4}>✉ undeliverable</Text>
                              </Tooltip>
                            )}
                          </List.Item>
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
                        size="xs" fz={15}
                        variant="light"
                        onClick={() => setEditHouseholdId(household.id)}
                      >
                        Edit Info
                      </Button>
                      <Button
                        size="xs" fz={15}
                        variant="light"
                        onClick={() => router.push(`/membership-ops/participants/new?householdId=${household.id}`)}
                      >
                        + Add Participant
                      </Button>
                      {isDenied ? (
                        <Button
                          size="xs" fz={15}
                          variant="light"
                          color="blue"
                          onClick={() => setDenied(household.id, false)}
                        >
                          Restore Access
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="xs" fz={15}
                            variant="light"
                            color={hasActiveMembership ? 'red' : 'green'}
                            disabled={ownGrantBlocked}
                            title={ownGrantBlocked ? "You can't grant your own household's membership — a sysadmin must." : undefined}
                            onClick={() => toggleMembership(household.id, hasActiveMembership)}
                          >
                            {hasActiveMembership ? "Revoke Membership" : "Grant Membership"}
                          </Button>
                          <Button
                            size="xs" fz={15}
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

            {filtered.length === 0 && (
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

      <Modal
        opened={confirmDenyOpened}
        onClose={closeConfirmDeny}
        title={<Text span fw={700} fz="lg">Deny Membership</Text>}
        centered
      >
        <Text mb="lg">Deny membership for this household? Every member will be unable to log in.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeConfirmDeny}>Cancel</Button>
          <Button color="red" onClick={confirmDeny}>Deny Membership</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
