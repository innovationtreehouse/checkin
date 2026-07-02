"use client";

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Container, Group, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { formatCents } from '@inventory/money';
import { useUnsavedGuard } from '@/components/UnsavedChangesProvider';
import { isRegistrationDirty } from './dirty';

import { PageLoader } from "@/components/ui/PageLoader";
type RegProgram = {
  name: string;
  nonMemberPriceCents: number | null;
  minAge: number | null;
  maxAge: number | null;
  enrollmentStatus?: string;
  maxParticipants: number | null;
  // Anonymous callers no longer receive the participant rows (PII/association
  // gate in the route) — only the aggregate count. Keep the rows as a fallback
  // for staff/enrolled callers who still get them.
  _count?: { participants?: number };
  participants?: unknown[];
};

function SectionHeader({ title, description }: { title: string, description?: string }) {
  return (
    <div>
      <Title order={4} c="blue">{title}</Title>
      {description && <Text size="sm" c="dimmed">{description}</Text>}
    </div>
  );
}

export default function PublicRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [program, setProgram] = useState<RegProgram | null>(null);
  const [loadingProgram, setLoadingProgram] = useState(true);
  const [programError, setProgramError] = useState("");

  const [parents, setParents] = useState([{ name: '', email: '', phone: '' }]);
  const [emergencyContact, setEmergencyContact] = useState({ name: '', phone: '' });
  const [participants, setParticipants] = useState<{ name: string; dob: string }[]>([{ name: '', dob: '' }]);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Public page: no app sidebar, so the native beforeunload from the guard infra
  // is the whole protection. Dirty once any field is typed; cleared on submit so
  // the post-submit redirect doesn't prompt.
  useUnsavedGuard(!submitted && isRegistrationDirty(parents, emergencyContact, participants));

  useEffect(() => {
    const fetchProgram = async () => {
      try {
        const res = await fetch(`/api/programs/${id}`);
        if (res.ok) {
          const data = await res.json();
          setProgram(data);
          if (data.enrollmentStatus === 'CLOSED') {
            setProgramError("Registration is currently closed for this program.");
          } else if (data.maxParticipants !== null && (data._count?.participants ?? data.participants?.length ?? 0) >= data.maxParticipants) {
            setProgramError("This program is currently full.");
          }
        } else {
          setProgramError("Failed to load program details.");
        }
      } catch {
        setProgramError("Network error.");
      } finally {
        setLoadingProgram(false);
      }
    };
    fetchProgram();
  }, [id]);

  const handleAddParent = () => {
    if (parents.length < 2) setParents([...parents, { name: '', email: '', phone: '' }]);
  };
  const handleRemoveParent = (index: number) => setParents(parents.filter((_, i) => i !== index));
  const handleParentChange = (index: number, field: string, value: string) => {
    const newParents = [...parents];
    newParents[index] = { ...newParents[index], [field]: value };
    setParents(newParents);
  };

  const handleAddParticipant = () => setParticipants([...participants, { name: '', dob: '' }]);
  const handleRemoveParticipant = (index: number) => {
    if (participants.length > 1) setParticipants(participants.filter((_, i) => i !== index));
  };
  const handleParticipantChange = (index: number, field: string, value: string) => {
    const newParticipants = [...participants];
    newParticipants[index] = { ...newParticipants[index], [field]: value };
    setParticipants(newParticipants);
  };

  const validateForm = () => {
    setError("");
    if (!parents[0].name || !parents[0].email || !parents[0].phone) {
      setError("Primary parent/guardian information is required.");
      return false;
    }
    if (!emergencyContact.name || !emergencyContact.phone) {
      setError("Emergency contact is required.");
      return false;
    }
    if (parents.some(p => p.phone && p.phone.replace(/\D/g, '') === emergencyContact.phone.replace(/\D/g, ''))) {
      setError("Emergency contact phone must be different from parent/guardian phone numbers.");
      return false;
    }
    for (let i = 0; i < participants.length; i++) {
      if (!participants[i].name) {
        setError(`Participant ${i + 1} is missing a name.`);
        return false;
      }
      if (!participants[i].dob && (program?.minAge !== null || program?.maxAge !== null)) {
        const isMatchingParent = parents.some(parent => parent.name.toLowerCase().trim() === participants[i].name.toLowerCase().trim());
        if (!isMatchingParent) {
          setError(`Participant ${i + 1} needs a Date of Birth for age verification.`);
          return false;
        }
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/programs/${id}/public-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parents, emergencyContact, participants })
      });

      const data = await res.json();
      if (res.ok) {
        setSubmitted(true); // clears the unsaved-changes guard before any redirect
        if (data.checkoutUrl) {
          setSuccess("Registration started! Redirecting you to checkout...");
          // Defer one tick so React flushes the guard effect (dirty→false)
          // before the full-page nav, else beforeunload would still prompt.
          setTimeout(() => { window.location.href = data.checkoutUrl; }, 0);
        } else {
          setSuccess("Registration successful! Check your email for confirmation.");
          setTimeout(() => router.push(`/programs/${id}`), 3000);
        }
      } else {
        setError(data.error || "Failed to register.");
        setSubmitting(false);
      }
    } catch {
      setError("Network error occurred.");
      setSubmitting(false);
    }
  };

  if (loadingProgram) {
    return <PageLoader />;
  }

  if (programError || !program) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={3} c="red">{programError || "Program Not Found"}</Title>
          <Group justify="center" mt="lg">
            <Button onClick={() => router.push(`/programs/${id}`)}>Go Back</Button>
          </Group>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Stack align="center" gap={4} mb="lg">
          <Title order={1}>Register for Program</Title>
          <Text c="dimmed" fz="lg">{program.name}</Text>
          {program.nonMemberPriceCents !== null && (
            <Text c="green" fz="lg">
              Cost: {formatCents(program.nonMemberPriceCents)} {participants.length > 1 ? `× ${participants.length}` : ''}
            </Text>
          )}
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack gap="xl">
            {/* Parents Section */}
            <Card withBorder radius="md" padding="lg">
              <SectionHeader title="Family Information" description="Every account needs at least one primary adult/guardian." />
              <Stack mt="md">
                {parents.map((parent, index) => (
                  <Card key={index} withBorder={index > 0} radius="md" padding={index > 0 ? "md" : 0} pos="relative">
                    {index > 0 && (
                      <Button type="button" size="compact-xs" color="red" variant="light" pos="absolute" top={10} right={10} onClick={() => handleRemoveParent(index)}>
                        Remove
                      </Button>
                    )}
                    <Text fw={600} mb="sm">{index === 0 ? 'Primary Guardian' : 'Secondary Guardian (Optional)'}</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput label="Full Name" required={index === 0} value={parent.name} onChange={e => handleParentChange(index, 'name', e.currentTarget.value)} placeholder="Jane Doe" />
                      <TextInput type="email" label="Email Address" required={index === 0} value={parent.email} onChange={e => handleParentChange(index, 'email', e.currentTarget.value)} placeholder="jane@example.com" />
                      <TextInput type="tel" label="Phone Number" required={index === 0} value={parent.phone} onChange={e => handleParentChange(index, 'phone', e.currentTarget.value)} placeholder="(555) 123-4567" />
                    </SimpleGrid>
                  </Card>
                ))}
                {parents.length < 2 && (
                  <Button type="button" variant="light" onClick={handleAddParent} style={{ alignSelf: 'flex-start' }}>
                    + Add Secondary Guardian
                  </Button>
                )}
              </Stack>
            </Card>

            {/* Emergency Contact */}
            <Card withBorder radius="md" padding="lg">
              <SectionHeader title="Emergency Contact" description="Someone outside the immediate household we can call." />
              <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
                <TextInput label="Contact Name" required value={emergencyContact.name} onChange={e => setEmergencyContact({ ...emergencyContact, name: e.currentTarget.value })} placeholder="John Smith" />
                <TextInput type="tel" label="Contact Phone" required value={emergencyContact.phone} onChange={e => setEmergencyContact({ ...emergencyContact, phone: e.currentTarget.value })} placeholder="(555) 987-6543" />
              </SimpleGrid>
            </Card>

            {/* Participants */}
            <Card withBorder radius="md" padding="lg">
              <SectionHeader title="Program Participants" description="Who is attending this program?" />
              <Stack mt="md">
                {participants.map((p, index) => (
                  <Card key={index} withBorder radius="md" padding="md" pos="relative">
                    {participants.length > 1 && (
                      <Button type="button" size="compact-xs" color="red" variant="light" pos="absolute" top={10} right={10} onClick={() => handleRemoveParticipant(index)}>
                        Remove
                      </Button>
                    )}
                    <Text fw={600} mb="sm">Participant {index + 1}</Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput label="Full Name" required value={p.name} onChange={e => handleParticipantChange(index, 'name', e.currentTarget.value)} placeholder="Child or Adult Name" />
                      <TextInput
                        type="date"
                        label="Date of Birth (Optional for Adults)"
                        required={!parents.some(parent => parent.name.toLowerCase().trim() === p.name.toLowerCase().trim()) && (program?.minAge !== null || program?.maxAge !== null)}
                        value={p.dob}
                        onChange={e => handleParticipantChange(index, 'dob', e.currentTarget.value)}
                      />
                    </SimpleGrid>
                  </Card>
                ))}
                <Button type="button" variant="light" onClick={handleAddParticipant} style={{ alignSelf: 'flex-start' }}>
                  + Add Another Participant
                </Button>
              </Stack>
            </Card>

            {error && <Alert color="red">{error}</Alert>}
            {success && <Alert color="green">{success}</Alert>}

            <Group justify="space-between">
              <Button type="button" variant="default" onClick={() => router.push(`/programs/${id}`)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={submitting} loading={submitting}>
                {program.nonMemberPriceCents !== null ? "Pay & Register via Shopify" : "Complete Registration"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
