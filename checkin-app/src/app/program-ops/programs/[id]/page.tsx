"use client";

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireRole } from '@/hooks/useRequireRole';
import Link from 'next/link';
import {
  Alert, Anchor, Badge, Box, Button, Card, Center, Checkbox, Container, Divider, Group,
  Loader, NumberInput, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title,
} from '@mantine/core';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { EntityPicker } from '@/components/admin/EntityPicker';
import { ScrollableTabsList } from '@/components/ui/ScrollableTabsList';
import { formatDateTime, calculateAge } from '@/lib/time';
import { formatPhone } from '@/lib/phone';

type ProgramDetail = {
  id: number;
  name: string;
  startAt: string | null;
  endAt: string | null;
  leadMentorId: number | null;
  phase: string;
  enrollmentStatus: string;
  minAge: number | null;
  maxAge: number | null;
  maxParticipants: number | null;
  memberOnly: boolean;
  participants: {
    participantId: number;
    status: string;
    pendingSince: string | null;
    participant: {
      name: string | null;
      email: string;
      phone?: string | null;
      household?: { emergencyContacts: { id: number; name: string; phone: string; relationship: string | null }[] } | null;
    };
  }[];
  volunteers: { participantId: number; isCore: boolean; participant: { name: string | null; email: string } }[];
  events: { id: number; name: string; startAt: string; endAt: string; attendanceConfirmedAt: string | null }[];
  leadMentor: { name: string | null; email: string } | null;
  memberPriceCents: number | null;
  nonMemberPriceCents: number | null;
  shopifyProductId: string | null;
};

type ParticipantOption = { id: number; name: string | null; email: string; dateOfBirth?: string | null };

const PHASE_BADGE: Record<string, { label: string; color: string }> = {
  PLANNING: { label: 'Planning', color: 'gray' },
  UPCOMING: { label: 'Upcoming', color: 'yellow' },
  RUNNING: { label: 'Running', color: 'cyan' },
  FINISHED: { label: 'Finished', color: 'teal' },
};

export default function ProgramDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user: sessionUser, loading: authLoading, ready } = useRequireRole([]);
  const router = useRouter();

  const [program, setProgram] = useState<ProgramDetail | null>(null);

  // Form States
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [phase, setPhase] = useState("PLANNING");
  const [enrollmentStatus, setEnrollmentStatus] = useState("CLOSED");
  const [memberOnly, setMemberOnly] = useState(false);
  const [leadMentorIdInput, setLeadMentorIdInput] = useState("");
  const [memberPrice, setMemberPrice] = useState("");
  const [nonMemberPrice, setNonMemberPrice] = useState("");

  const [newVolId, setNewVolId] = useState("");
  const [newPartId, setNewPartId] = useState("");

  // EntityPicker owns the transient query/results/loading; we keep only the selected id + its display label.
  const [volLabel, setVolLabel] = useState("");
  const [mentorSearch, setMentorSearch] = useState("");
  const [isEditingMentor, setIsEditingMentor] = useState(false);
  const [partLabel, setPartLabel] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<'general' | 'roster' | 'events'>('general');

  const fetchProgram = useCallback(async () => {
    try {
      const res = await fetch(`/api/programs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProgram(data);
        setStartAt(data.startAt ? data.startAt.split('T')[0] : "");
        setEndAt(data.endAt ? data.endAt.split('T')[0] : "");
        setMinAge(data.minAge !== null ? String(data.minAge) : "");
        setMaxAge(data.maxAge !== null ? String(data.maxAge) : "");
        setMaxParticipants(data.maxParticipants !== null ? String(data.maxParticipants) : "");
        setPhase(data.phase || "PLANNING");
        setEnrollmentStatus(data.enrollmentStatus || "CLOSED");
        setMemberOnly(Boolean(data.memberOnly));
        setLeadMentorIdInput(data.leadMentorId !== null ? String(data.leadMentorId) : "");
        setMemberPrice(data.memberPriceCents !== null ? String(data.memberPriceCents / 100) : "");
        setNonMemberPrice(data.nonMemberPriceCents !== null ? String(data.nonMemberPriceCents / 100) : "");
        setMentorSearch(data.leadMentor ? `${data.leadMentor.name || 'Unnamed'} (${data.leadMentor.email})` : "");
        setIsEditingMentor(false);
      } else if (res.status === 404) {
        setMessage("Program not found.");
      } else {
        setMessage("Failed to load program.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) fetchProgram();
  }, [ready, fetchProgram]);

  // Volunteer + participant pickers both search this program's eligible members.
  const searchEligible = useCallback(async (query: string): Promise<ParticipantOption[]> => {
    const res = await fetch(`/api/programs/${id}/eligible-participants?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.members || [];
  }, [id]);

  // Lead-mentor picker searches adult members.
  const searchAdults = useCallback(async (query: string): Promise<ParticipantOption[]> => {
    const res = await fetch(`/api/participants/search?q=${encodeURIComponent(query)}&filter=adults`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.participants || [];
  }, []);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAt: startAt || null,
          endAt: endAt || null,
          minAge: minAge ? parseInt(minAge) : null,
          maxAge: maxAge ? parseInt(maxAge) : null,
          maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
          phase, enrollmentStatus, memberOnly,
          leadMentorId: leadMentorIdInput ? parseInt(leadMentorIdInput) : null,
          memberPrice: memberPrice || null,
          nonMemberPrice: nonMemberPrice || null,
        })
      });
      if (res.ok) {
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 3000);
        fetchProgram();
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to save settings.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddVolunteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVolId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/programs/${id}/volunteers`, {
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
      await fetch(`/api/programs/${id}/volunteers`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId }) });
      fetchProgram();
    } catch { }
  };

  const handleToggleCore = async (participantId: number, isCore: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/programs/${id}/volunteers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId, isCore }) });
      if (res.ok) fetchProgram();
    } finally {
      setSaving(false);
    }
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartId) return;

    const u = sessionUser as { isSysadmin?: boolean; isBoardMember?: boolean } | undefined;
    if (u?.isSysadmin || u?.isBoardMember) {
      if (!confirm("Warning: Adding a participant manually bypasses all payment requirements. Are you sure you wish to proceed?")) return;
    }

    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/programs/${id}/participants`, {
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
      await fetch(`/api/programs/${id}/participants`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId }) });
      fetchProgram();
    } catch { }
  };

  if (loading || authLoading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  if (!program) return (
    <Container size="sm" py="xl">
      <Card withBorder radius="md" padding="xl" ta="center">
        <Title order={3}>{message || "Not Found"}</Title>
        <Group justify="center" mt="lg"><Button onClick={() => router.push('/program-ops/programs')}>Back</Button></Group>
      </Card>
    </Container>
  );

  // Ownership gate stays inline — it needs the loaded program (lead-mentor id)
  // to decide, which useRequireRole (a static role gate) can't express.
  const user = sessionUser as unknown as { id: number; isSysadmin?: boolean; isBoardMember?: boolean };
  const isAuthorized = program.leadMentorId === user?.id || user?.isSysadmin || user?.isBoardMember;
  const activeParticipants = program.participants.filter(p => p.status === 'ACTIVE');
  const pendingParticipants = program.participants.filter(p => p.status === 'PENDING');

  if (!isAuthorized) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={3}>Forbidden: Not authorized to manage this program.</Title>
          <Group justify="center" mt="lg"><Button onClick={() => router.push('/program-ops/programs')}>Back</Button></Group>
        </Card>
      </Container>
    );
  }

  const sortedVolunteers = program.volunteers ? [...program.volunteers].sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0)) : [];
  const isSysAdminOrBoard = user?.isSysadmin || user?.isBoardMember;
  const phaseBadge = PHASE_BADGE[program.phase];
  // Pricing is fixed at creation; derive rather than track as state.
  const isFree = program.memberPriceCents === null && program.nonMemberPriceCents === null;

  const downloadQr = () => {
    const url = `${window.location.origin}/programs/${program.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
    const link = document.createElement('a');
    link.href = qrUrl;
    link.download = `QR_${program.name.replace(/[^a-z0-9]/gi, '_')}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Container size="lg" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="lg">
          <Group align="center" gap="sm">
            <Title order={1}>{program.name}</Title>
            {phaseBadge && <Badge color={phaseBadge.color} variant="light" size="lg">{phaseBadge.label}</Badge>}
          </Group>
          <Button variant="default" onClick={() => router.push('/program-ops/programs')}>← Back to Programs</Button>
        </Group>

        <AlertBanner message={message} tone="info" mb="lg" />

        <Tabs value={activeTab} onChange={(v) => setActiveTab((v as typeof activeTab) ?? 'general')}>
          <ScrollableTabsList mb="lg">
            <Tabs.Tab value="general">General</Tabs.Tab>
            <Tabs.Tab value="roster">Roster</Tabs.Tab>
            <Tabs.Tab value="events">Events</Tabs.Tab>
          </ScrollableTabsList>

          {/* GENERAL */}
          <Tabs.Panel value="general">
            <form onSubmit={handleSaveGeneral}>
              <Stack mb="lg">
                <Group wrap="wrap">
                  <Button type="button" variant="light" onClick={downloadQr}>📷 Download QR Code</Button>
                  <Button type="button" color="teal" variant="light" onClick={() => window.open(`/programs/${program.id}/register`, '_blank')}>🔗 Public Registration Page</Button>
                  <Button type="button" variant="default" onClick={() => window.open(`/programs/${program.id}`, '_blank')}>📄 Public Details Page</Button>
                </Group>

                <Card withBorder radius="md" padding="md">
                  <Group justify="space-around">
                    <Stack gap={0} align="center"><Text fz="xl" fw={700}>{program.participants?.length || 0} {program.maxParticipants ? `/ ${program.maxParticipants}` : ''}</Text><Text size="sm" c="dimmed">Participants Enrolled</Text></Stack>
                    <Divider orientation="vertical" />
                    <Stack gap={0} align="center"><Text fz="xl" fw={700}>{program.volunteers?.length || 0}</Text><Text size="sm" c="dimmed">Assigned Volunteers</Text></Stack>
                    <Divider orientation="vertical" />
                    <Stack gap={0} align="center"><Text fz="xl" fw={700}>{program.events?.length || 0}</Text><Text size="sm" c="dimmed">Scheduled Sessions</Text></Stack>
                  </Group>
                </Card>

                {program.shopifyProductId && (
                  <Alert color="green" variant="light">✓ Pre-configured for Shopify Checkout (Product ID: {program.shopifyProductId})</Alert>
                )}
              </Stack>

              <Stack>
                <Card withBorder radius="md" padding="md">
                  <Text fw={500} mb="sm">Lead Mentor / Program Coordinator</Text>
                  {isSysAdminOrBoard ? (
                    program.leadMentor && !isEditingMentor ? (
                      <Group>
                        <Text c="green">{program.leadMentor.name || 'Unnamed'} ({program.leadMentor.email})</Text>
                        <Button size="xs" fz={15} variant="default" type="button" onClick={() => { setIsEditingMentor(true); setMentorSearch(""); setLeadMentorIdInput(""); }}>Change</Button>
                      </Group>
                    ) : (
                      <Group gap="sm" align="flex-start" wrap="nowrap">
                        <Box style={{ flex: 1 }}>
                          <EntityPicker<ParticipantOption>
                            placeholder="Search Adult Members..."
                            selectedId={leadMentorIdInput || null}
                            selectedLabel={mentorSearch}
                            search={searchAdults}
                            getOptionLabel={(p) => p.name || 'Unnamed'}
                            getOptionDescription={(p) => p.email}
                            onSelect={(p) => { setLeadMentorIdInput(p.id.toString()); setMentorSearch(`${p.name || 'Unnamed'} (${p.email})`); }}
                            onClear={() => { setLeadMentorIdInput(""); setMentorSearch(""); }}
                          />
                        </Box>
                        {program.leadMentor && (
                          <Button size="xs" fz={15} variant="subtle" color="red" type="button" onClick={() => { setIsEditingMentor(false); setLeadMentorIdInput(String(program.leadMentorId)); setMentorSearch(`${program.leadMentor?.name || 'Unnamed'} (${program.leadMentor?.email})`); }}>Cancel</Button>
                        )}
                      </Group>
                    )
                  ) : (
                    program.leadMentor ? <Text c="green">{program.leadMentor.name || 'Unnamed'} ({program.leadMentor.email})</Text> : <Text c="dimmed">No Lead Mentor Assigned</Text>
                  )}
                  <Text size="xs" c={isSysAdminOrBoard ? 'yellow' : 'dimmed'} mt="xs">
                    {isSysAdminOrBoard ? '*You have permission to reassign this program.' : '*Only Administrators/Board Members can change the Lead Mentor.'}
                  </Text>
                </Card>

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput type="date" label="Start Date" value={startAt} onChange={e => setStartAt(e.currentTarget.value)} />
                  <TextInput type="date" label="End Date" value={endAt} onChange={e => setEndAt(e.currentTarget.value)} />
                  <NumberInput label="Minimum Age (Optional)" value={minAge} onChange={v => setMinAge(String(v))} min={0} placeholder="e.g. 14" />
                  <NumberInput label="Maximum Age (Optional)" value={maxAge} onChange={v => setMaxAge(String(v))} min={0} placeholder="e.g. 18" />
                </SimpleGrid>

                <div>
                  <NumberInput label="Max Participants (Optional)" value={maxParticipants} onChange={v => setMaxParticipants(String(v))} min={1} placeholder="Leave blank for unlimited" description="Sets the inventory limit on Shopify. Leave blank for unlimited enrollment." />
                  {(memberPrice || nonMemberPrice) && !maxParticipants && (
                    <Alert color="yellow" variant="light" mt="xs">⚠️ No max participants set — Shopify will allow unlimited purchases for this program.</Alert>
                  )}
                </div>

                <Checkbox checked={isFree} disabled label="This is a free program (Pricing cannot be changed)" />

                {!isFree && (
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <NumberInput label="Member Price ($)" value={memberPrice} disabled />
                    <NumberInput label="Non-Member Price ($)" value={nonMemberPrice} disabled />
                  </SimpleGrid>
                )}

                <Checkbox checked={memberOnly} onChange={e => setMemberOnly(e.currentTarget.checked)} label="Member-Only Program" />

                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Select label="Program Phase" value={phase} onChange={v => setPhase(v ?? 'PLANNING')} allowDeselect={false}
                    data={[
                      { value: 'PLANNING', label: 'Planning (Draft)' },
                      { value: 'UPCOMING', label: 'Upcoming (Published)' },
                      { value: 'RUNNING', label: 'Currently Running' },
                      { value: 'FINISHED', label: 'Finished' },
                    ]} />
                  <Select label="Enrollment Status" value={enrollmentStatus} onChange={v => setEnrollmentStatus(v ?? 'CLOSED')} allowDeselect={false}
                    data={[
                      { value: 'OPEN', label: 'Open for Enrollment' },
                      { value: 'CLOSED', label: 'Closed for Enrollment (Full / Stopped)' },
                    ]} />
                </SimpleGrid>

                <Group gap="sm">
                  <Button type="submit" color="green" disabled={saving || !leadMentorIdInput} loading={saving}>
                    Save Settings
                  </Button>
                  {justSaved && <Text c="green" fw={500}>✓ Saved</Text>}
                </Group>
              </Stack>
            </form>
          </Tabs.Panel>

          {/* ROSTER */}
          <Tabs.Panel value="roster">
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
          </Tabs.Panel>

          {/* EVENTS */}
          <Tabs.Panel value="events">
            <Group justify="space-between" align="center" mb="md">
              <Title order={4}>Events ({program.events.length})</Title>
              <Button variant="light" onClick={() => router.push(`/program-ops/sessions/new?programId=${program.id}`)}>+ Schedule Session(s)</Button>
            </Group>
            <Table.ScrollContainer minWidth={500}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Event Name</Table.Th>
                    <Table.Th>Start Time</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {program.events.map(ev => {
                    const isPastEvent = new Date(ev.endAt) < new Date();
                    const needsConfirmation = isPastEvent && !ev.attendanceConfirmedAt;
                    return (
                      <Table.Tr key={ev.id}>
                        <Table.Td fw={500}>{ev.name}</Table.Td>
                        <Table.Td c="dimmed">{formatDateTime(ev.startAt)}</Table.Td>
                        <Table.Td ta="right">
                          {needsConfirmation ? (
                            <Button component={Link} href={`/program-ops/sessions/${ev.id}`} size="compact-xs" color="yellow" variant="light">Confirm Attendance</Button>
                          ) : (
                            <Anchor component={Link} href={`/program-ops/sessions/${ev.id}`}>{isPastEvent ? 'Attendance →' : 'Edit Event →'}</Anchor>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {program.events.length === 0 && (
                    <Table.Tr><Table.Td colSpan={3} ta="center"><Text c="dimmed" py="md">No events scheduled.</Text></Table.Td></Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Tabs.Panel>
        </Tabs>
      </Card>
    </Container>
  );
}
