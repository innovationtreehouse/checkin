"use client";

import { useCallback, useState } from 'react';
import { Alert, Badge, Box, Button, Card, Checkbox, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { EntityPicker } from '@/components/admin/EntityPicker';
import { calculateAge, formatDateTime } from '@/lib/time';
import { formatPhone } from '@/lib/phone';
import type { ProgramDetail, ParticipantOption } from './page';

type ProgramRosterTabProps = {
  programId: string;
  program: Pick<ProgramDetail, 'volunteers' | 'participants' | 'startAt' | 'minAge' | 'maxAge'>;
  isSysAdminOrBoard: boolean;
  setMessage: (msg: string) => void;
  fetchProgram: () => Promise<void>;
};

export function ProgramRosterTab({ programId, program, isSysAdminOrBoard, setMessage, fetchProgram }: ProgramRosterTabProps) {
  const [saving, setSaving] = useState(false);
  const [newVolId, setNewVolId] = useState("");
  const [volLabel, setVolLabel] = useState("");
  const [newPartId, setNewPartId] = useState("");
  const [partLabel, setPartLabel] = useState("");

  const sortedVolunteers = program.volunteers ? [...program.volunteers].sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0)) : [];
  const activeParticipants = program.participants.filter(p => p.status === 'ACTIVE');
  const pendingParticipants = program.participants.filter(p => p.status === 'PENDING');

  // Volunteer + participant pickers both search this program's eligible members.
  const searchEligible = useCallback(async (query: string): Promise<ParticipantOption[]> => {
    const res = await fetch(`/api/programs/${programId}/eligible-participants?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.members || [];
  }, [programId]);

  const handleAddVolunteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVolId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/programs/${programId}/volunteers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: parseInt(newVolId) })
      });
      if (res.ok) { setNewVolId(""); setVolLabel(""); fetchProgram(); }
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveVolunteer = async (participantId: number) => {
    if (!confirm("Remove this volunteer?")) return;
    try {
      await fetch(`/api/programs/${programId}/volunteers`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId }) });
      fetchProgram();
    } catch { }
  };

  const handleToggleCore = async (participantId: number, isCore: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/programs/${programId}/volunteers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId, isCore }) });
      if (res.ok) fetchProgram();
    } finally {
      setSaving(false);
    }
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartId) return;

    if (isSysAdminOrBoard) {
      if (!confirm("Warning: Adding a participant manually bypasses all payment requirements. Are you sure you wish to proceed?")) return;
    }

    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/programs/${programId}/participants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: parseInt(newPartId), override: true })
      });
      if (res.ok) { setNewPartId(""); setPartLabel(""); fetchProgram(); }
      else {
        const data = await res.json();
        setMessage(data.error || "Failed to enroll participant.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveParticipant = async (participantId: number) => {
    if (!confirm("Remove this participant?")) return;
    try {
      await fetch(`/api/programs/${programId}/participants`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId }) });
      fetchProgram();
    } catch { }
  };

  return (
    <Stack gap="xl">
      {/* Volunteers */}
      <Card withBorder radius="md" padding="lg">
        <Title order={4} mb="md">Volunteers ({program.volunteers.length})</Title>
        <form onSubmit={handleAddVolunteer}>
          <Group align="flex-end" gap="md" mb="lg" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 200 }}>
              <EntityPicker<ParticipantOption>
                label="Assign Volunteer (Name/Email)"
                placeholder="Start typing to search..."
                selectedId={newVolId || null}
                selectedLabel={volLabel}
                search={searchEligible}
                getOptionLabel={(p) => p.name || 'Unnamed'}
                getOptionDescription={(p) => p.email}
                onSelect={(p) => { setNewVolId(p.id.toString()); setVolLabel(`${p.name || 'Unnamed'} (${p.email})`); }}
                onClear={() => { setNewVolId(""); setVolLabel(""); }}
              />
            </Box>
            <Button type="submit" disabled={saving || !newVolId}>Add</Button>
          </Group>
        </form>

        {program.volunteers.length === 0 ? <Text c="dimmed">No volunteers assigned.</Text> : (
          <Stack gap="xs">
            {sortedVolunteers.map(v => (
              <Group key={v.participantId} justify="space-between" p="sm" style={{ borderRadius: 6, background: 'var(--mantine-color-default-hover)' }}>
                <Group gap="md" wrap="wrap">
                  <Text fw={500}>{v.participant.name || 'Unnamed'} <Text component="span" c="dimmed" size="sm">({v.participant.email})</Text></Text>
                  <Checkbox size="xs" checked={v.isCore} disabled={saving} onChange={e => handleToggleCore(v.participantId, e.currentTarget.checked)}
                    label={<Text size="sm" c={v.isCore ? 'yellow' : undefined}>Core Volunteer</Text>} />
                </Group>
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => handleRemoveVolunteer(v.participantId)}>Remove</Button>
              </Group>
            ))}
          </Stack>
        )}
      </Card>

      {/* Active Participants */}
      <Card withBorder radius="md" padding="lg">
        <Title order={4} mb="md">Active Participants ({activeParticipants.length})</Title>
        <form onSubmit={handleAddParticipant}>
          <Group align="flex-end" gap="md" mb="lg" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 200 }}>
              <EntityPicker<ParticipantOption>
                label="Assign Participant (Name/Email)"
                placeholder="Start typing to search..."
                selectedId={newPartId || null}
                selectedLabel={partLabel}
                search={searchEligible}
                getOptionLabel={(p) => p.name || 'Unnamed'}
                getOptionDescription={(p) => {
                  let warning: string | null = null;
                  if (p.dateOfBirth) {
                    const age = calculateAge(p.dateOfBirth, program.startAt ?? undefined);
                    if (program.minAge !== null && age < program.minAge) warning = `⚠️ Too Young (${age})`;
                    if (program.maxAge !== null && age > program.maxAge) warning = `⚠️ Too Old (${age})`;
                  }
                  return (
                    <Group gap="xs" justify="space-between" wrap="nowrap">
                      <span>{p.email}</span>
                      {warning && <Badge color="yellow" variant="light">{warning}</Badge>}
                    </Group>
                  );
                }}
                onSelect={(p) => { setNewPartId(p.id.toString()); setPartLabel(`${p.name || 'Unnamed'} (${p.email})`); }}
                onClear={() => { setNewPartId(""); setPartLabel(""); }}
              />
            </Box>
            {!isSysAdminOrBoard ? (
              <Alert color="yellow" variant="light" style={{ flex: 1 }}>
                ⚠️ Program Leads cannot manually enroll participants. Participants must enroll themselves and complete payment via Shopify.
              </Alert>
            ) : (
              <Button type="submit" disabled={saving || !newPartId}>Enroll</Button>
            )}
          </Group>
        </form>

        {activeParticipants.length === 0 ? <Text c="dimmed">No active participants yet.</Text> : (
          <Stack gap="xs">
            {activeParticipants.map(p => (
              <Card key={p.participantId} withBorder radius="sm" padding="sm">
                <Group justify="space-between">
                  <Text fw={700} c="blue">{p.participant.name || 'Unnamed'}</Text>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => handleRemoveParticipant(p.participantId)}>Remove</Button>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs" spacing="xs">
                  <Text size="sm" c="dimmed"><strong>Email:</strong> {p.participant.email}</Text>
                  <Text size="sm" c="dimmed"><strong>Phone:</strong> {p.participant.phone ? formatPhone(p.participant.phone) : 'N/A'}</Text>
                  {p.participant.household && (
                    <Text size="sm" c="dimmed" style={{ gridColumn: '1 / -1' }}>
                      <strong>Emergency Contact{(p.participant.household.emergencyContacts?.length ?? 0) > 1 ? 's' : ''}:</strong>{' '}
                      {p.participant.household.emergencyContacts && p.participant.household.emergencyContacts.length > 0
                        ? p.participant.household.emergencyContacts.map((c) => `${c.name} - ${formatPhone(c.phone)}`).join('; ')
                        : 'N/A'}
                    </Text>
                  )}
                </SimpleGrid>
              </Card>
            ))}
          </Stack>
        )}
      </Card>

      {/* Pending Participants */}
      <Card withBorder radius="md" padding="lg">
        <Title order={4} mb="md">Pending Participants ({pendingParticipants.length})</Title>
        {pendingParticipants.length === 0 ? <Text c="dimmed">No pending participants.</Text> : (
          <Stack gap="xs">
            {pendingParticipants.map(p => (
              <Card key={p.participantId} withBorder radius="sm" padding="sm">
                <Group justify="space-between">
                  <Text fw={700} c="yellow">{p.participant.name || 'Unnamed'}</Text>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => handleRemoveParticipant(p.participantId)}>Remove</Button>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs" spacing="xs">
                  <Text size="sm" c="dimmed"><strong>Email:</strong> {p.participant.email}</Text>
                  <Text size="sm" c="dimmed"><strong>Phone:</strong> {p.participant.phone ? formatPhone(p.participant.phone) : 'N/A'}</Text>
                  <Text size="sm" c="dimmed"><strong>Pending Since:</strong> {p.pendingSince ? formatDateTime(p.pendingSince) : 'Unknown'}</Text>
                </SimpleGrid>
              </Card>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
