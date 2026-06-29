"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Center, Checkbox, Container, Group, Loader, NumberInput, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { EntityPicker } from '@/components/admin/EntityPicker';

type ParticipantOption = {
  id: number;
  name: string | null;
  email: string;
};

export default function CreateProgramPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember'], { redirectTo: '/system-status' });
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

  // Lead Mentor selection state (the EntityPicker owns the transient query/results)
  const [leadMentorId, setLeadMentorId] = useState("");
  const [mentorSearch, setMentorSearch] = useState("");

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
          memberPrice: (!isFree && memberPrice) ? memberPrice : null,
          nonMemberPrice: (!isFree && nonMemberPrice) ? nonMemberPrice : null,
          maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
          leadMentorId: leadMentorId ? parseInt(leadMentorId) : null
        })
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/program-ops/programs/${data.program.id}`);
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

  if (authLoading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  return (
    <Container size="md" pb="md">
      <Card withBorder radius="md" padding="lg">
        <AdminPageHeader title="Create Program" mb="md" />

        <Text c="dimmed" mb="lg">
          Create a new program. You can configure the roster and schedule events later.
        </Text>

        <AlertBanner message={message} tone={messageType === 'success' ? 'success' : 'error'} mb="md" />

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
            <EntityPicker<ParticipantOption>
              label="Lead Mentor / Program Coordinator"
              description="The lead mentor will be able to manage this program's roster and events."
              placeholder="Search by name or email..."
              selectedId={leadMentorId || null}
              selectedLabel={mentorSearch}
              search={async (q) => {
                const res = await fetch(`/api/participants/search?q=${encodeURIComponent(q)}&filter=adults`);
                if (!res.ok) return [];
                const data = await res.json();
                return data.participants || [];
              }}
              getOptionLabel={(p) => p.name || 'Unnamed'}
              getOptionDescription={(p) => p.email}
              onSelect={(p) => { setLeadMentorId(p.id.toString()); setMentorSearch(`${p.name || 'Unnamed'} (${p.email})`); }}
              onClear={() => { setLeadMentorId(""); setMentorSearch(""); }}
            />

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
