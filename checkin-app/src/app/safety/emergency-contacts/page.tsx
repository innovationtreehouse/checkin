"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge, Card, Center, Group, List, Loader, Paper, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";
import { formatPhone } from "@/lib/phone";

type ParticipantInfo = {
  id: number;
  name: string | null;
  isPresent: boolean;
};

type LeadInfo = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
};

type Household = {
  id: number;
  name: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContacts: EmergencyContactInfo[];
  isPresent: boolean;
  participants: ParticipantInfo[];
  leads: LeadInfo[];
};

type EmergencyContactInfo = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  relationship: string | null;
  invalid: boolean;
};

export default function EmergencyContactsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember', 'isKeyholder']);

  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/safety/emergency-contacts');
      if (res.ok) {
        const data = await res.json();

        // Sort so that households with physically present participants float to the top
        const sorted = (data.households || []).sort((a: Household, b: Household) => {
          if (a.isPresent && !b.isPresent) return -1;
          if (!a.isPresent && b.isPresent) return 1;
          return (a.name || "").localeCompare(b.name || "");
        });

        setHouseholds(sorted);
      } else {
        setError("Failed to load emergency contacts. Ensure you have the proper authorizations.");
      }
    } catch (e) {
      console.error(e);
      setError("Network error loading contacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchContacts();
  }, [ready, fetchContacts]);

  // Derived state for searching
  const filteredHouseholds = households.filter((h) => {
    const query = searchQuery.toLowerCase();
    if (h.name && h.name.toLowerCase().includes(query)) return true;
    if (h.leads.some(l => l.name && l.name.toLowerCase().includes(query))) return true;
    if (h.participants.some(p => p.name && p.name.toLowerCase().includes(query))) return true;
    return false;
  });

  if (authLoading || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  if (error) {
    return (
      <Center mih="60vh">
        <Title order={3} c="red">{error}</Title>
      </Center>
    );
  }

  return (
    <Stack>
      <Card withBorder radius="md" padding="lg">
        <Text c="dimmed">
          Directory of primary guardians and emergency contacts across all active accounts.
          Households with members physically present are pinned to the top.
        </Text>
        <TextInput
          mt="md"
          size="md"
          placeholder="Search by Household Name, Parent Name, or Household Member Name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </Card>

      <Stack>
        {filteredHouseholds.map((h) => (
          <Card
            key={h.id}
            withBorder
            radius="md"
            padding="lg"
            style={h.isPresent ? { borderColor: 'var(--mantine-color-cyan-5)' } : undefined}
          >
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
              {/* Household & Participants */}
              <div>
                <Group gap="xs" mb="xs">
                  <Text fw={600} fz="lg">{h.name || `Household #${h.id}`}</Text>
                  {h.isPresent && <Badge color="cyan" variant="light">Present Now</Badge>}
                </Group>
                <Text size="sm" c="dimmed">Household members:</Text>
                {h.participants.length > 0 ? (
                  <List size="sm">
                    {h.participants.map((p) => (
                      <List.Item key={p.id}>
                        {p.name || `Member #${p.id}`}
                        {p.isPresent && <Text component="span" c="green" size="sm"> ● (Checked In)</Text>}
                      </List.Item>
                    ))}
                  </List>
                ) : (
                  <Text size="sm" c="dimmed" fs="italic">No household members</Text>
                )}
              </div>

              {/* Leads / Parents */}
              <div>
                <Text size="sm" c="dimmed" mb="xs">Household Leads:</Text>
                {h.leads.length > 0 ? (
                  <Stack gap="xs">
                    {h.leads.map((l) => (
                      <Paper key={l.id} withBorder radius="sm" p="xs">
                        <Text fw={500}>{l.name || l.email}</Text>
                        <Text size="sm" c="dimmed">Phone: {l.phone ? formatPhone(l.phone) : "Not Provided"}</Text>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Paper withBorder radius="sm" p="xs">
                    <Text size="sm" c="red">No designated leads found.</Text>
                  </Paper>
                )}
              </div>

              {/* Emergency Contacts */}
              <div>
                <Text size="sm" c="dimmed" mb="xs">External Emergency Contacts:</Text>
                <Stack gap="xs">
                  {h.emergencyContacts.filter(c => !c.invalid).length > 0 ? (
                    h.emergencyContacts.filter(c => !c.invalid).map((c) => (
                      <Paper key={c.id} withBorder radius="sm" p="md" bg="var(--mantine-color-red-light)">
                        <Text fw={600}>{c.name}{c.relationship ? ` (${c.relationship})` : ''}</Text>
                        <Text size="sm" mt={4}>Phone: {c.phone ? formatPhone(c.phone) : "Not Provided"}</Text>
                        {c.email && <Text size="sm">Email: {c.email}</Text>}
                      </Paper>
                    ))
                  ) : (
                    <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-red-light)">
                      <Text size="sm" c="red" fs="italic">Not Configured</Text>
                    </Paper>
                  )}
                  {h.emergencyContacts.some(c => c.invalid) && (
                    <Text size="xs" c="red">⚠ One or more contacts are invalid (now a household member).</Text>
                  )}
                </Stack>
              </div>
            </SimpleGrid>
          </Card>
        ))}

        {filteredHouseholds.length === 0 && (
          <Card withBorder radius="md" padding="xl" ta="center">
            <Text c="dimmed">No households found matching your search.</Text>
          </Card>
        )}
      </Stack>
    </Stack>
  );
}
