"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, Card, Center, Checkbox, Container, Group, Loader, NumberInput, Paper, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';

type ParticipantOption = {
  id: number;
  name: string | null;
  email: string;
};

export default function CreateProgramPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [name, setName] = useState("");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [memberPrice, setMemberPrice] = useState("");
  const [nonMemberPrice, setNonMemberPrice] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [memberOnly, setMemberOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  // Lead Mentor search state
  const [leadMentorId, setLeadMentorId] = useState("");
  const [mentorSearch, setMentorSearch] = useState("");
  const [mentorResults, setMentorResults] = useState<ParticipantOption[]>([]);
  const [mentorSearching, setMentorSearching] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      const isAuthorized = session.user?.sysadmin || session.user?.boardMember;
      if (!isAuthorized) {
        router.push('/admin');
      }
    }
  }, [status, router, session]);

  // Debounced mentor search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (mentorSearch && !leadMentorId) {
        const searchMentors = async () => {
          setMentorSearching(true);
          try {
            const res = await fetch(`/api/admin/participants/search?q=${encodeURIComponent(mentorSearch)}&filter=adults`);
            if (res.ok) {
              const data = await res.json();
              setMentorResults(data.participants || []);
            }
          } finally {
            setMentorSearching(false);
          }
        };
        searchMentors();
      } else if (!mentorSearch) {
        setMentorResults([]);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [mentorSearch, leadMentorId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setSaving(true);
    setMessage("");

    try {
      const res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          begin: begin || null,
          end: end || null,
          memberOnly,
          minAge: minAge ? parseInt(minAge) : null,
          maxAge: maxAge ? parseInt(maxAge) : null,
          memberPrice: (!isFree && memberPrice) ? parseInt(memberPrice) : null,
          nonMemberPrice: (!isFree && nonMemberPrice) ? parseInt(nonMemberPrice) : null,
          maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
          leadMentorId: leadMentorId ? parseInt(leadMentorId) : null
        })
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/admin/programs/${data.program.id}`);
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to create program.");
        setMessageType("error");
        setSaving(false);
      }
    } catch {
      setMessage("Network error creating program.");
      setMessageType("error");
      setSaving(false);
    }
  };

  if (status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null;

  return (
    <Container size="md" py="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="md">
          <Title order={1}>Create Program</Title>
          <Button variant="default" onClick={() => router.push('/programs')}>← Back to Programs</Button>
        </Group>

        <Text c="dimmed" mb="lg">
          Create a new program. You can configure the roster and schedule events later.
        </Text>

        {message && <Alert color={messageType === 'success' ? 'green' : 'red'} mb="md">{message}</Alert>}

        <form onSubmit={handleCreate}>
          <Stack>
            <TextInput
              label="Program Name"
              required
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. FRC Robotics 2026"
            />

            {/* Lead Mentor Selector */}
            <Box pos="relative">
              <TextInput
                label="Lead Mentor / Program Coordinator"
                description="The lead mentor will be able to manage this program's roster and events."
                value={mentorSearch}
                onChange={(e) => { setMentorSearch(e.currentTarget.value); setLeadMentorId(""); }}
                placeholder="Search by name or email..."
                rightSection={leadMentorId ? (
                  <Button variant="subtle" color="red" size="compact-xs" onClick={() => { setLeadMentorId(""); setMentorSearch(""); }}>
                    Clear
                  </Button>
                ) : undefined}
                rightSectionWidth={leadMentorId ? 60 : undefined}
              />
              {mentorSearching && <Text size="xs" c="dimmed" mt={4}>Loading...</Text>}
              {mentorResults.length > 0 && !leadMentorId && (
                <Paper withBorder shadow="md" radius="sm" pos="absolute" left={0} right={0} style={{ zIndex: 10, maxHeight: 200, overflowY: 'auto' }}>
                  {mentorResults.map((p) => (
                    <Box
                      key={p.id}
                      p="sm"
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--mantine-color-default-border)' }}
                      onClick={() => { setLeadMentorId(p.id.toString()); setMentorSearch(`${p.name || 'Unnamed'} (${p.email})`); setMentorResults([]); }}
                    >
                      <Text fw={500}>{p.name || 'Unnamed'}</Text>
                      <Text size="xs" c="dimmed">{p.email}</Text>
                    </Box>
                  ))}
                </Paper>
              )}
            </Box>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput label="Min Age (Optional)" value={minAge} onChange={(v) => setMinAge(String(v))} min={0} />
              <NumberInput label="Max Age (Optional)" value={maxAge} onChange={(v) => setMaxAge(String(v))} min={0} />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput type="date" label="Start Date" value={begin} onChange={(e) => setBegin(e.currentTarget.value)} />
              <TextInput type="date" label="End Date" value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
            </SimpleGrid>

            <Card withBorder radius="md" padding="md">
              <Checkbox
                checked={isFree}
                onChange={(e) => {
                  setIsFree(e.currentTarget.checked);
                  if (e.currentTarget.checked) {
                    setMemberPrice("");
                    setNonMemberPrice("");
                  }
                }}
                label="This is a free program"
              />
            </Card>

            {!isFree && (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NumberInput label="Member Price ($)" value={memberPrice} onChange={(v) => setMemberPrice(String(v))} min={0} placeholder="0" />
                  <NumberInput label="Non-Member Price ($)" value={nonMemberPrice} onChange={(v) => setNonMemberPrice(String(v))} min={0} placeholder="0" />
                </SimpleGrid>
                <Text size="xs" c="dimmed">Setting a price automatically creates a checkout flow on Shopify.</Text>
                {Number(memberPrice) > Number(nonMemberPrice) && (
                  <Alert color="yellow" variant="light">⚠️ Member price is higher than non-member price.</Alert>
                )}
              </>
            )}

            <div>
              <NumberInput
                label="Max Participants (Optional)"
                value={maxParticipants}
                onChange={(v) => setMaxParticipants(String(v))}
                min={1}
                placeholder="Leave blank for unlimited"
                description="Sets the inventory limit on Shopify. Leave blank for unlimited enrollment."
              />
              {(memberPrice || nonMemberPrice) && !maxParticipants && (
                <Alert color="yellow" variant="light" mt="xs">
                  ⚠️ No max participants set — Shopify will allow unlimited purchases for this program.
                </Alert>
              )}
            </div>

            <Checkbox
              checked={memberOnly}
              onChange={(e) => setMemberOnly(e.currentTarget.checked)}
              label="Member-Only Program"
              description="If checked, this program will only be visible to logged-in users with active memberships."
            />

            <Group justify="flex-end">
              <Button type="submit" color="green" disabled={saving || !name.trim() || !leadMentorId} loading={saving}>
                Create Program
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
