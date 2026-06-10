"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Center, Group, List, Loader, Paper, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";

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
  isPresent: boolean;
  participants: ParticipantInfo[];
  leads: LeadInfo[];
};

export default function EmergencyContactsPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember', 'keyholder']);
  const router = useRouter();

  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/emergency-contacts');
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
        <Stack align="center">
          <Title order={3} c="red">{error}</Title>
          <Button onClick={() => router.push('/admin')}>Back to Admin</Button>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack>
      <Card withBorder radius="md" padding="lg">
        <Title order={1}>🚑 Emergency Contacts</Title>
        <Text c="dimmed" mt="xs">
          Directory of primary guardians and emergency contacts across all active accounts.
          Households with members physically present are pinned to the top.
        </Text>
        <TextInput
          mt="md"
          size="md"
          placeholder="Search by Household Name, Parent Name, or Member Name..."
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
                <Text size="sm" c="dimmed">Members:</Text>
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
                  <Text size="sm" c="dimmed" fs="italic">No enrolled members</Text>
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
                        <Text size="sm" c="dimmed">Phone: {l.phone || "Not Provided"}</Text>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Paper withBorder radius="sm" p="xs">
                    <Text size="sm" c="red">No designated leads found.</Text>
                  </Paper>
                )}
              </div>

              {/* Emergency Contact */}
              <div>
                <Text size="sm" c="dimmed" mb="xs">External Emergency Contact:</Text>
                <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-red-light)">
                  {h.emergencyContactName ? (
                    <>
                      <Text fw={600}>{h.emergencyContactName}</Text>
                      <Text size="sm" mt={4}>Phone: {h.emergencyContactPhone || "Not Provided"}</Text>
                    </>
                  ) : (
                    <Text size="sm" c="red" fs="italic">Not Configured</Text>
                  )}
                </Paper>
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
