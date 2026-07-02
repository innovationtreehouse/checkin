"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { EntityPicker } from '@/components/admin/EntityPicker';
import { isYouth } from '@/lib/time';
import { Button, Card, Center, Checkbox, Container, Loader, Paper, Stack, Text, TextInput } from '@mantine/core';
import { AlertBanner } from '@/components/admin/AlertBanner';

type HouseholdOption = {
  id: number;
  name: string;
  householdMembers: { id: number; name: string | null; email: string | null }[];
};

export default function NewParticipantPage() {
  return (
    <Suspense fallback={<Center mih="60vh"><Loader /></Center>}>
      <NewParticipantForm />
    </Suspense>
  );
}

function NewParticipantForm() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);
  const searchParams = useSearchParams();
  const queryHouseholdId = searchParams.get('householdId');

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [dob, setDob] = useState("");

  // Household selection state (the EntityPicker owns the transient query/results)
  const [householdId, setHouseholdId] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");

  const isYouthSelected = isYouth(dob);

  const [alreadyMember, setAlreadyMember] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  // Handle deep linked household
  useEffect(() => {
    if (queryHouseholdId && !householdId) {
      const fetchHousehold = async () => {
        try {
          const res = await fetch(`/api/membership-ops/households?id=${queryHouseholdId}`);
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
      const res = await fetch('/api/membership-ops/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: email || null,
          parentEmail: isYouthSelected ? parentEmail : null,
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

  const submitDisabled = saving || (!isYouthSelected && !email && !householdId) || (isYouthSelected && !parentEmail && !householdId);

  return (
    <Container size="md" pb="md">
      <Card withBorder radius="md" padding="lg">
        <AdminPageHeader title="Register New User" back={{ href: '/membership-ops', label: '← Membership Ops' }} mb="md" />

        <Text c="dimmed" mb="lg">
          System Administrators can manually register a new participant into the database. When they
          log in via their Google email for the first time, their account will instantly link to
          this profile.
        </Text>

        <AlertBanner message={message} tone={isError ? 'error' : 'success'} mb="md" />

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
              description={isYouthSelected ? 'Student Detected' : undefined}
              value={dob}
              onChange={(e) => setDob(e.currentTarget.value)}
              maw={300}
            />

            <TextInput
              type="email"
              label={`Participant Google Email ${isYouthSelected ? '(Optional for Students)' : ''}`}
              required={!isYouthSelected && !householdId}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="jane.doe@example.com"
            />

            {isYouthSelected && (
              <Paper withBorder radius="md" p="md" bg="var(--mantine-color-grape-light)">
                <TextInput
                  type="email"
                  label={`Parent / Guardian Google Email ${!householdId ? '' : '(Optional)'}`}
                  description="Because the participant is under 18, a parent or guardian's email is required to associate their accounts — unless you assign them to an existing household below."
                  required={isYouthSelected && !householdId}
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.currentTarget.value)}
                  placeholder="parent@example.com"
                />
              </Paper>
            )}

            {/* Household Selector */}
            <Paper withBorder radius="md" p="md">
              <EntityPicker<HouseholdOption>
                label="Add to Existing Household (Optional)"
                description="Search by household name or member name/email. If left blank, a new household will be created automatically for adults."
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
