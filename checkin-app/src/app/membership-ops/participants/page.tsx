"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Card, Group, Modal, Paper, Stack, Table, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { AdminEditHouseholdModal } from "@/components/admin/AdminEditHouseholdModal";

type HouseholdRef = {
  id: number;
  name: string | null;
  participants: { id: number; name: string | null; email: string | null }[];
};

type ParticipantRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  household?: HouseholdRef | null;
};

export default function AdminParticipantsIndex() {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"id" | "name" | "email" | "household">("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const router = useRouter();

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
      const res = await fetch(`/api/participants/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.participants) {
        setResults(data.participants);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantRow | null>(null);
  const [householdId, setHouseholdId] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showingNewHouseholdConfirm, setShowingNewHouseholdConfirm] = useState(false);

  // Edit Participant State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<ParticipantRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  // Admin edit of household's own info (name, address, emergency contact)
  const [editHouseholdId, setEditHouseholdId] = useState<number | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    notifications.show({ message, color: type === 'error' ? 'red' : 'green' });
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
        showNotification("Participant updated successfully!");
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(data.error || "Failed to update participant", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Network error", "error");
    } finally {
      setSavingDetails(false);
    }
  };

  const canSubmitAssign = !selectedParticipant?.household || (selectedParticipant.household.participants.length > 1);
  const canChangeHousehold = selectedParticipant?.household && selectedParticipant.household.participants.length === 1 && householdId;

  return (
    <Stack maw={1000} mx="auto">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Text c="dimmed">Search and manage system participants and households.</Text>
        </div>
        <Group>
          <Button variant="light" onClick={() => router.push('/membership-ops/participants/import')}>Bulk Import</Button>
          <Button color="green" onClick={() => router.push('/membership-ops/participants/new')}>+ New Participant</Button>
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
                            setEditForm({ name: p.name || "", email: p.email || "", phone: p.phone || "" });
                            setEditModalOpen(true);
                          }}>
                            Details
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : searchQuery && !loading ? (
            <Text ta="center" c="dimmed">No participants found.</Text>
          ) : null}
        </Box>
      </Card>

      {/* Assign household modal */}
      <Modal opened={assignModalOpen} onClose={closeAssign} title={<Title order={4}>Assign Household to {selectedParticipant?.name}</Title>} size="lg">
        {selectedParticipant?.household && (
          <Paper withBorder radius="md" p="md" mb="md">
            <Text size="sm" fw={600} c="dimmed" mb="xs">Current Household: {selectedParticipant.household.name}</Text>
            <Text size="sm">
              Members: {selectedParticipant.household.participants
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
              getOptionDescription={(h) => h.participants.map((p) => p.name || p.email || 'Unnamed').join(', ') || 'Empty'}
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
      <Modal opened={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingParticipant(null); }} title={<Title order={4}>Edit Participant</Title>} size="lg">
        <form onSubmit={handleEditParticipant}>
          <Stack>
            <TextInput label="Name" required value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.currentTarget.value }))} />
            <TextInput type="email" label="Email Address" value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.currentTarget.value }))} />
            <TextInput type="tel" label="Phone Number" value={editForm.phone} onChange={(e) => setEditForm(f => ({ ...f, phone: e.currentTarget.value }))} placeholder="(555) 123-4567" />
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
    </Stack>
  );
}
