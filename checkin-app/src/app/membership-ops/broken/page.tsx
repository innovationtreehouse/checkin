"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Card, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { formatDate, isMinor } from "@/lib/time";

type Member = { id: number; name: string | null; dateOfBirth: string | null };
type BrokenHousehold = { id: number; name: string; members: Member[] };

export default function BrokenHouseholdsPage() {
  const [households, setHouseholds] = useState<BrokenHousehold[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState<number | null>(null);

  const fetchHouseholds = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/broken-households");
      const data = await res.json();
      if (data.households) setHouseholds(data.households);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHouseholds();
  }, [fetchHouseholds]);

  const makeLead = async (participantId: number) => {
    setPromoting(participantId);
    try {
      const res = await fetch("/api/household/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (res.ok) {
        notifications.show({ color: "green", message: "Lead assigned." });
        fetchHouseholds();
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: "red", message: data.error || "Failed to assign lead." });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error." });
    } finally {
      setPromoting(null);
    }
  };

  if (loading) {
    return <Loader />;
  }

  return (
    <Stack maw={1000} mx="auto">
      <Text c="dimmed">
        Households with no lead. A family can&apos;t be claimed until someone is the lead — assign one here.
      </Text>

      <Box>
        {households.length > 0 ? (
          <Stack gap="sm">
            {households.map((h) => (
              <Card key={h.id} withBorder radius="md" padding="md">
                <Text fw={600} mb="xs">{h.name}</Text>
                {h.members.length > 0 ? (
                  <Stack gap={6}>
                    {h.members.map((m) => (
                      <Group key={m.id} justify="space-between" wrap="nowrap">
                        <Text size="sm">
                          {m.name || "Unnamed"}
                          {m.dateOfBirth ? ` • ${formatDate(m.dateOfBirth)}` : " • no birthdate"}
                          {isMinor(m.dateOfBirth) && (
                            <Badge ml="xs" size="xs" color="gray" variant="light">minor</Badge>
                          )}
                        </Text>
                        {!isMinor(m.dateOfBirth) && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            loading={promoting === m.id}
                            onClick={() => makeLead(m.id)}
                          >
                            Make Lead
                          </Button>
                        )}
                      </Group>
                    ))}
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">No members to promote.</Text>
                )}
              </Card>
            ))}
          </Stack>
        ) : (
          <Text ta="center" c="dimmed">No broken households.</Text>
        )}
      </Box>
    </Stack>
  );
}
