"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useRequireRole } from '@/hooks/useRequireRole';
import { Alert, Box, Button, Card, Center, Checkbox, Container, Group, Loader, Paper, Stack, Text, TextInput, Title } from '@mantine/core';

type HouseholdOption = {
  id: number;
  name: string;
  participants: { id: number; name: string | null; email: string | null }[];
};

export default function NewParticipantPage() {
  return (
    <Suspense fallback={<Center mih="60vh"><Loader /></Center>}>
      <NewParticipantForm />
    </Suspense>
  );
}

function NewParticipantForm() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember']);
  const searchParams = useSearchParams();
  const queryHouseholdId = searchParams.get('householdId');

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [dob, setDob] = useState("");

  // Household search state
  const [householdId, setHouseholdId] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");
  const [householdResults, setHouseholdResults] = useState<HouseholdOption[]>([]);
  const [householdSearching, setHouseholdSearching] = useState(false);

  const isStudent = () => {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age < 18;
  };

  const studentSelected = isStudent();

  const [alreadyMember, setAlreadyMember] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  // Handle deep linked household
  useEffect(() => {
    if (queryHouseholdId && !householdId) {
      const fetchHousehold = async () => {
        try {
          const res = await fetch(`/api/admin/households?id=${queryHouseholdId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.household) {
              setHouseholdId(data.household.id.toString());
              setHouseholdSearch(data.household.name || `Household #${data.household.id}`);
            }
          }
        } catch (err) {
          console.error("Failed to fetch deep linked household:", err);
        }
      };
      fetchHousehold();
    }
  }, [queryHouseholdId, householdId]);

  // Debounced household search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (householdSearch && !householdId) {
        const search = async () => {
          setHouseholdSearching(true);
          try {
            const res = await fetch(`/api/admin/households?q=${encodeURIComponent(householdSearch)}`);
            if (res.ok) {
              const data = await res.json();
              setHouseholdResults(data.households || []);
            }
          } finally {
            setHouseholdSearching(false);
          }
        };
        search();
      } else if (!householdSearch) {
        setHouseholdResults([]);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [householdSearch, householdId]);

  if (authLoading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setIsError(false);

    try {
      const res = await fetch('/api/admin/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: email || null,
          parentEmail: studentSelected ? parentEmail : null,
          dob: dob || null,
          householdId: householdId ? parseInt(householdId) : null,
          alreadyMember: !householdId && alreadyMember
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Participant ${name || data.participant.email || 'created'} successfully!`);
        setName("");
        setEmail("");
        setParentEmail("");
        setDob("");
        setHouseholdId("");
        setHouseholdSearch("");
        setAlreadyMember(false);
      } else {
        setIsError(true);
        setMessage(data.error || "Failed to create participant");
      }
    } catch {
      setIsError(true);
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  };

  const submitDisabled = saving || (!studentSelected && !email && !householdId) || (studentSelected && !parentEmail && !householdId);

  return (
    <Container size="md" py="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="md">
          <Title order={1}>Register New User</Title>
          <Button component={Link} href="/admin" variant="default">← Admin Hub</Button>
        </Group>

        <Text c="dimmed" mb="lg">
          System Administrators can manually register a new participant into the database. When they
          log in via their Google email for the first time, their account will instantly link to
          this profile.
        </Text>

        {message && <Alert color={isError ? 'red' : 'green'} mb="md">{message}</Alert>}

        <form onSubmit={handleSubmit}>
          <Stack>
            <TextInput
              label="Full Name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Jane Doe"
            />

            <TextInput
              type="date"
              label="Date of Birth"
              description={studentSelected ? 'Student Detected' : undefined}
              value={dob}
              onChange={(e) => setDob(e.currentTarget.value)}
              maw={300}
            />

            <TextInput
              type="email"
              label={`Participant Google Email ${studentSelected ? '(Optional for Students)' : ''}`}
              required={!studentSelected && !householdId}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="jane.doe@example.com"
            />

            {studentSelected && (
              <Paper withBorder radius="md" p="md" bg="var(--mantine-color-grape-light)">
                <TextInput
                  type="email"
                  label={`Parent / Guardian Google Email ${!householdId ? '' : '(Optional)'}`}
                  description="Because the participant is under 18, a parent or guardian's email is required to associate their accounts — unless you assign them to an existing household below."
                  required={studentSelected && !householdId}
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.currentTarget.value)}
                  placeholder="parent@example.com"
                />
              </Paper>
            )}

            {/* Household Selector */}
            <Paper withBorder radius="md" p="md" pos="relative">
              <TextInput
                label="Add to Existing Household (Optional)"
                description="Search by household name or member name/email. If left blank, a new household will be created automatically for adults."
                value={householdSearch}
                onChange={(e) => { setHouseholdSearch(e.currentTarget.value); setHouseholdId(""); }}
                placeholder="Search households..."
                rightSection={householdId ? (
                  <Button variant="subtle" color="red" size="compact-xs" onClick={() => { setHouseholdId(""); setHouseholdSearch(""); }}>
                    Clear
                  </Button>
                ) : undefined}
                rightSectionWidth={householdId ? 60 : undefined}
              />
              {householdSearching && <Text size="xs" c="dimmed" mt={4}>Searching...</Text>}
              {householdResults.length > 0 && !householdId && (
                <Paper withBorder shadow="md" radius="sm" pos="absolute" left={16} right={16} style={{ zIndex: 10, maxHeight: 250, overflowY: 'auto' }}>
                  {householdResults.map((h) => (
                    <Box
                      key={h.id}
                      p="sm"
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--mantine-color-default-border)' }}
                      onClick={() => {
                        setHouseholdId(h.id.toString());
                        setHouseholdSearch(h.name || `Household #${h.id}`);
                        setHouseholdResults([]);
                      }}
                    >
                      <Text fw={500}>{h.name || `Household #${h.id}`}</Text>
                      <Text size="xs" c="dimmed">
                        {h.participants.map((p) => p.name || p.email || 'Unnamed').join(', ') || 'Empty'}
                      </Text>
                    </Box>
                  ))}
                </Paper>
              )}
            </Paper>

            {!householdId && (
              <Checkbox
                checked={alreadyMember}
                onChange={(e) => setAlreadyMember(e.currentTarget.checked)}
                label="Confirm this household is already a paid member"
                description="Leave unchecked for new visitors. Membership is normally earned through the application process."
              />
            )}

            <Button type="submit" color="green" disabled={submitDisabled} loading={saving} mt="sm">
              Create Participant
            </Button>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
