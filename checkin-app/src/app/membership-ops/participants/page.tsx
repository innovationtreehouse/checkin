"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Card, Group, Modal, Paper, Stack, Switch, Table, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { AdminEditHouseholdModal } from "@/components/admin/AdminEditHouseholdModal";
import { RoleBadge, roleLabel } from "@/components/ui/RoleBadge";
import { useRequireRole } from "@/hooks/useRequireRole";

type HouseholdRef = {
  id: number;
  name: string | null;
  householdMembers: { id: number; name: string | null; email: string | null }[];
};

type RoleFlag = "isSysadmin" | "isBoardMember" | "isKeyholder" | "isBackgroundCheckReviewer" | "isOperations";
const ROLE_FLAGS: RoleFlag[] = ["isSysadmin", "isBoardMember", "isKeyholder", "isBackgroundCheckReviewer", "isOperations"];

type PersonRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth?: string | null;
  isDeclaredAdult?: boolean;
  lastBackgroundCheck?: string | null;
  household?: HouseholdRef | null;
  isSysadmin?: boolean;
  isBoardMember?: boolean;
  isKeyholder?: boolean;
  isBackgroundCheckReviewer?: boolean;
  isOperations?: boolean;
};

export default function AdminParticipantsIndex() {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"id" | "name" | "email" | "household">("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const router = useRouter();
  // Typed session user for the client-side role-edit actor matrix (UX only — the
  // endpoint is the real guard). Empty allowed list = any authenticated user; the
  // membership-ops layout already enforces the page's real access gate.
  const { user: me } = useRequireRole([]);

  const toggleSort = (col: "id" | "name" | "email" | "household") => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const sortedResults = [...results].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (sortBy === "id") {
      av = a.id;
      bv = b.id;
    } else if (sortBy === "household") {
      av = (a.household?.name || "").toLowerCase();
      bv = (b.household?.name || "").toLowerCase();
    } else {
      av = (a[sortBy] || "").toLowerCase();
      bv = (b[sortBy] || "").toLowerCase();
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  useEffect(() => {
    const id = setTimeout(() => fetchParticipants(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const fetchParticipants = async (query = "") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.people) {
        setResults(data.people);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<PersonRow | null>(null);
  const [householdId, setHouseholdId] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showingNewHouseholdConfirm, setShowingNewHouseholdConfirm] = useState(false);

  // Edit Participant State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<PersonRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", isDeclaredAdult: false, lastBackgroundCheck: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  // Admin edit of household's own info (name, address, emergency contact)
  const [editHouseholdId, setEditHouseholdId] = useState<number | null>(null);

  // Edit Roles state
  const [rolesTarget, setRolesTarget] = useState<PersonRow | null>(null);
  const [rolesForm, setRolesForm] = useState<Record<RoleFlag, boolean>>({
    isSysadmin: false, isBoardMember: false, isKeyholder: false, isBackgroundCheckReviewer: false, isOperations: false,
  });
  const [savingRoles, setSavingRoles] = useState(false);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    notifications.show({ message, color: type === 'error' ? 'red' : 'green', autoClose: type === 'error' ? false : 4000 });
  };

  const openRolesModal = (p: PersonRow) => {
    setRolesTarget(p);
    setRolesForm({
      isSysadmin: !!p.isSysadmin,
      isBoardMember: !!p.isBoardMember,
      isKeyholder: !!p.isKeyholder,
      isBackgroundCheckReviewer: !!p.isBackgroundCheckReviewer,
      isOperations: !!p.isOperations,
    });
  };

  const closeRolesModal = () => setRolesTarget(null);

  // Client-side mirror of the server's authority matrix (§4.3) — UX only, so
  // switches the actor can't legally flip are disabled with an explanation.
  // The endpoint enforces the real rule regardless of what this renders.
  const roleSwitchState = (field: RoleFlag): { disabled: boolean; reason?: string } => {
    if (me?.isBoardMember) return { disabled: false };
    if (me?.isSysadmin) {
      if (field === 'isBoardMember' && rolesTarget?.isBoardMember) {
        return { disabled: true, reason: 'Only board members can remove board membership' };
      }
      return { disabled: false };
    }
    return { disabled: true, reason: 'You do not have permission to edit roles' };
  };

  const handleSaveRoles = () => {
    if (!rolesTarget) return;
    const target = rolesTarget;
    const current: Record<RoleFlag, boolean> = {
      isSysadmin: !!target.isSysadmin,
      isBoardMember: !!target.isBoardMember,
      isKeyholder: !!target.isKeyholder,
      isBackgroundCheckReviewer: !!target.isBackgroundCheckReviewer,
      isOperations: !!target.isOperations,
    };
    const delta: Partial<Record<RoleFlag, boolean>> = {};
    for (const field of ROLE_FLAGS) {
      if (rolesForm[field] !== current[field]) delta[field] = rolesForm[field];
    }
    if (Object.keys(delta).length === 0) {
      closeRolesModal();
      return;
    }
    const deltaText = (Object.keys(delta) as RoleFlag[])
      .map((f) => `${delta[f] ? 'Grant' : 'Revoke'} ${roleLabel(f)}`)
      .join('; ');
    modals.openConfirmModal({
      title: "Update roles?",
      children: (
        <Text size="sm">
          {deltaText} — for <strong>{target.name || target.email}</strong>
        </Text>
      ),
      labels: { confirm: 'Save', cancel: 'Cancel' },
      onConfirm: () => saveRoles(target, delta),
    });
  };

  const saveRoles = async (target: PersonRow, delta: Partial<Record<RoleFlag, boolean>>) => {
    setSavingRoles(true);
    const previous = { ...target };
    // Optimistic update
    setResults(results.map((p) => (p.id === target.id ? { ...p, ...delta } : p)));
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: target.id, ...delta }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(results.map((p) => (p.id === target.id ? { ...p, ...data.user } : p)));
        showNotification("Roles updated.");
        closeRolesModal();
      } else {
        const data = await res.json().catch(() => ({}));
        // Revert optimistic update
        setResults(results.map((p) => (p.id === target.id ? previous : p)));
        showNotification(data.error || "Failed to update roles", "error");
      }
    } catch (err) {
      console.error(err);
      setResults(results.map((p) => (p.id === target.id ? previous : p)));
      showNotification("Network error updating roles", "error");
    } finally {
      setSavingRoles(false);
    }
  };

  const closeAssign = () => {
    setAssignModalOpen(false);
    setSelectedParticipant(null);
    setHouseholdSearch("");
    setHouseholdId("");
    setShowingNewHouseholdConfirm(false);
  };

  const handleAssignHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParticipant) return;

    // If pulling from an existing household into a NEW one, ask for confirmation
    if (selectedParticipant.household && !householdId && !showingNewHouseholdConfirm) {
      setShowingNewHouseholdConfirm(true);
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch(`/api/membership-ops/participants/${selectedParticipant.id}/household`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          householdId: householdId ? parseInt(householdId) : undefined,
          createNew: !householdId
        })
      });
      if (res.ok) {
        const data = await res.json();
        setResults(results.map(p => p.id === selectedParticipant.id ? data.participant : p));
        closeAssign();
        showNotification("Household assigned successfully!");
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || "Failed to assign household", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Network error", "error");
    } finally {
      setAssigning(false);
    }
  };

  const handleEditParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParticipant) return;
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/membership-ops/participants/${editingParticipant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        const data = await res.json();
        setResults(results.map(p => p.id === editingParticipant.id ? { ...p, ...data.participant } : p));
        setEditModalOpen(false);
        setEditingParticipant(null);
        showNotification("Person updated successfully!");
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || "Failed to update person", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Network error", "error");
    } finally {
      setSavingDetails(false);
    }
  };

  const canSubmitAssign = !selectedParticipant?.household || (selectedParticipant.household.householdMembers.length > 1);
  const canChangeHousehold = selectedParticipant?.household && selectedParticipant.household.householdMembers.length === 1 && householdId;

  return (
    <Stack maw={1000} mx="auto">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Text c="dimmed">Search and manage system people and households.</Text>
        </div>
        <Group>
          <Button variant="light" onClick={() => router.push('/membership-ops/participants/import')}>Bulk Import</Button>
          <Button color="green" onClick={() => router.push('/membership-ops/participants/new')}>+ New Person</Button>
        </Group>
      </Group>

      <Card withBorder radius="md" padding="lg">
        <TextInput
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
        />

        <Box mt="lg">
          {results.length > 0 ? (
            <Table.ScrollContainer minWidth={700}>
              <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    {([
                      { key: "id", label: "ID" },
                      { key: "name", label: "Name" },
                      { key: "email", label: "Email" },
                      { key: "household", label: "Household" },
                    ] as const).map((c) => {
                      const active = sortBy === c.key;
                      const Icon = !active ? IconSelector : sortDir === "asc" ? IconChevronUp : IconChevronDown;
                      return (
                        <Table.Th key={c.key}>
                          <UnstyledButton onClick={() => toggleSort(c.key)} style={{ fontWeight: 600, fontSize: "inherit" }}>
                            <Group gap={4} wrap="nowrap">
                              {c.label}
                              <Icon size={14} stroke={1.5} />
                            </Group>
                          </UnstyledButton>
                        </Table.Th>
                      );
                    })}
                    <Table.Th>Roles</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedResults.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td c="dimmed">{p.id}</Table.Td>
                      <Table.Td fw={600}>{p.name}</Table.Td>
                      <Table.Td>{p.email || <Text span c="dimmed">No email</Text>}</Table.Td>
                      <Table.Td>{p.household?.name || <Text span c="dimmed">No household</Text>}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="wrap">
                          {ROLE_FLAGS.filter((f) => p[f]).map((f) => (
                            <RoleBadge key={f} role={f} size="sm" />
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          {p.household ? (
                            <Button size="xs" fz={15} variant="light" onClick={() => setEditHouseholdId(p.household!.id)}>
                              Household
                            </Button>
                          ) : (
                            <Button size="xs" fz={15} variant="light" onClick={() => { setSelectedParticipant(p); setAssignModalOpen(true); }}>
                              Assign
                            </Button>
                          )}
                          <Button size="xs" fz={15} variant="default" onClick={() => {
                            setEditingParticipant(p);
                            setEditForm({ name: p.name || "", email: p.email || "", phone: p.phone || "", isDeclaredAdult: !!p.isDeclaredAdult, lastBackgroundCheck: p.lastBackgroundCheck ? p.lastBackgroundCheck.slice(0, 10) : "" });
                            setEditModalOpen(true);
                          }}>
                            Details
                          </Button>
                          <Button size="xs" fz={15} variant="default" onClick={() => openRolesModal(p)}>
                            Edit roles
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : searchQuery && !loading ? (
            <Text ta="center" c="dimmed">No people found.</Text>
          ) : null}
        </Box>
      </Card>

      {/* Assign household modal */}
      <Modal opened={assignModalOpen} onClose={closeAssign} title={<Text span fw={700} fz="lg">Assign Household to {selectedParticipant?.name}</Text>} size="lg">
        {selectedParticipant?.household && (
          <Paper withBorder radius="md" p="md" mb="md">
            <Text size="sm" fw={600} c="dimmed" mb="xs">Current Household: {selectedParticipant.household.name}</Text>
            <Text size="sm">
              Members: {selectedParticipant.household.householdMembers
                .filter((p) => p.id !== selectedParticipant.id)
                .map((p) => p.name || p.email)
                .join(', ') || 'No other members'}
            </Text>
          </Paper>
        )}

        {showingNewHouseholdConfirm ? (
          <Alert color="red" title="Are you sure?">
            <Text size="sm" mb="md">
              This will remove <strong>{selectedParticipant?.name}</strong> from their current family
              household and start a brand new household for them alone.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setShowingNewHouseholdConfirm(false)}>Go Back</Button>
              <Button color="red" onClick={handleAssignHousehold} loading={assigning}>Yes, Proceed</Button>
            </Group>
          </Alert>
        ) : (
          <form onSubmit={handleAssignHousehold}>
            <EntityPicker<HouseholdRef>
              label="Search for Existing Household"
              description="If left blank, a new household will be created."
              placeholder="Search households..."
              selectedId={householdId || null}
              selectedLabel={householdSearch}
              search={async (q) => {
                const res = await fetch(`/api/membership-ops/households?q=${encodeURIComponent(q)}`);
                if (!res.ok) return [];
                const data = await res.json();
                return data.households || [];
              }}
              getOptionLabel={(h) => h.name || `Household #${h.id}`}
              getOptionDescription={(h) => h.householdMembers.map((p) => p.name || p.email || 'Unnamed').join(', ') || 'Empty'}
              onSelect={(h) => { setHouseholdId(h.id.toString()); setHouseholdSearch(h.name || `Household #${h.id}`); }}
              onClear={() => { setHouseholdId(""); setHouseholdSearch(""); }}
            />
            <Group justify="flex-end" mt="lg">
              <Button type="button" variant="default" onClick={closeAssign} disabled={assigning}>Cancel</Button>
              {canSubmitAssign && (
                <Button type="submit" color="green" disabled={assigning} loading={assigning}>
                  {householdId ? "Add to Household" : (selectedParticipant?.household ? "Pull from household and start a new one" : "Create New Household")}
                </Button>
              )}
              {canChangeHousehold && (
                <Button type="submit" disabled={assigning} loading={assigning}>Change Household</Button>
              )}
            </Group>
          </form>
        )}
      </Modal>

      {/* Edit participant modal */}
      <Modal opened={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingParticipant(null); }} title={<Text span fw={700} fz="lg">Edit Person</Text>} size="lg">
        <form onSubmit={handleEditParticipant}>
          <Stack>
            {/* Read e.currentTarget.value synchronously into a local before the setState
                updater -- React nulls a synthetic event's currentTarget once its dispatch
                cycle ends, and the updater callback runs later (next render phase), not at
                call time. Reading it lazily inside the updater intermittently crashed with
                "Cannot read properties of null (reading 'value')". */}
            <TextInput label="Name" required value={editForm.name} onChange={(e) => { const value = e.currentTarget.value; setEditForm(f => ({ ...f, name: value })); }} />
            <TextInput type="email" label="Email Address" value={editForm.email} onChange={(e) => { const value = e.currentTarget.value; setEditForm(f => ({ ...f, email: value })); }} />
            <TextInput type="tel" label="Phone Number" value={editForm.phone} onChange={(e) => { const value = e.currentTarget.value; setEditForm(f => ({ ...f, phone: value })); }} placeholder="(555) 123-4567" />
            {editingParticipant?.dateOfBirth ? (
              <Text size="sm" c="dimmed">Age is derived from date of birth on file; the adult declaration doesn&apos;t apply.</Text>
            ) : (
              <Switch
                label="Adult (25 or older)"
                description="Set this when there's no date of birth on file so the person shows as 'Adult' instead of 'Age Unavailable'."
                checked={editForm.isDeclaredAdult}
                onChange={(e) => { const checked = e.currentTarget.checked; setEditForm(f => ({ ...f, isDeclaredAdult: checked })); }}
              />
            )}
            <TextInput
              type="date"
              label="Last Background Check Review"
              description="Date the board last reviewed this person's background check. Clear the field to remove it."
              value={editForm.lastBackgroundCheck}
              onChange={(e) => { const value = e.currentTarget.value; setEditForm(f => ({ ...f, lastBackgroundCheck: value })); }}
            />
            {editingParticipant?.household && (
              <div>
                <Text fw={500} size="sm" mb={4}>Household</Text>
                <Paper withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="wrap">
                    <Text size="sm">{editingParticipant.household.name}</Text>
                    <Group gap="xs">
                      <Button size="xs" fz={15} variant="light" onClick={() => {
                        const hid = editingParticipant.household!.id;
                        setEditModalOpen(false);
                        setEditingParticipant(null);
                        setEditHouseholdId(hid);
                      }}>Edit Household Info</Button>
                      <Button size="xs" fz={15} variant="default" onClick={() => {
                        setEditModalOpen(false);
                        setSelectedParticipant(editingParticipant);
                        setEditingParticipant(null);
                        setAssignModalOpen(true);
                      }}>Move to Another Household</Button>
                    </Group>
                  </Group>
                </Paper>
              </div>
            )}
          </Stack>
          <Group justify="flex-end" mt="xl">
            <Button type="button" variant="default" onClick={() => { setEditModalOpen(false); setEditingParticipant(null); }} disabled={savingDetails}>Cancel</Button>
            <Button type="submit" disabled={savingDetails} loading={savingDetails}>Save Details</Button>
          </Group>
        </form>
      </Modal>

      {/* Admin edit of household's own info */}
      <AdminEditHouseholdModal
        householdId={editHouseholdId}
        opened={editHouseholdId !== null}
        onClose={() => setEditHouseholdId(null)}
        onSaved={(h) => {
          setResults(results.map(p =>
            p.household?.id === h.id ? { ...p, household: { ...p.household, name: h.name } } : p
          ));
        }}
      />

      {/* Edit roles modal */}
      <Modal opened={rolesTarget !== null} onClose={closeRolesModal} title={<Text span fw={700} fz="lg">Edit Roles — {rolesTarget?.name || rolesTarget?.email}</Text>}>
        <Stack>
          {ROLE_FLAGS.map((field) => {
            const { disabled, reason } = roleSwitchState(field);
            const switchEl = (
              <Switch
                label={roleLabel(field)}
                checked={rolesForm[field]}
                disabled={disabled}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setRolesForm((f) => ({ ...f, [field]: checked }));
                }}
              />
            );
            return (
              <div key={field}>
                {disabled && reason ? (
                  <Tooltip label={reason}>
                    <Box>{switchEl}</Box>
                  </Tooltip>
                ) : switchEl}
              </div>
            );
          })}
        </Stack>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={closeRolesModal} disabled={savingRoles}>Cancel</Button>
          <Button onClick={handleSaveRoles} disabled={savingRoles} loading={savingRoles}>Save</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
