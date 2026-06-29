"use client";

import { useState, useEffect } from "react";
import { Badge, Box, Card, Group, Stack, Text } from "@mantine/core";

type UnclaimedHousehold = {
  id: number;
  name: string;
  hasClaimedMember: boolean;
  members: { id: number; name: string | null; email: string | null }[];
};

export default function UnclaimedHouseholdsIndex() {
  const [households, setHouseholds] = useState<UnclaimedHousehold[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/membership-audit/unclaimed-households');
        const data = await res.json();
        if (data.households) setHouseholds(data.households);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Stack maw={1000} mx="auto">
      <div>
        <Text c="dimmed">Households with at least one member who has an email but has never signed in with Google.</Text>
      </div>

      <Box>
        {households.length > 0 ? (
          <Stack gap="sm">
            {households.map((h) => (
              <Card key={h.id} withBorder radius="md" padding="md">
                <Group justify="space-between" wrap="wrap" mb="xs">
                  <Text fw={600}>{h.name}</Text>
                  {h.hasClaimedMember && <Badge color="green" variant="light">Has a claimed member</Badge>}
                </Group>
                <Stack gap={4}>
                  {h.members.map((m) => (
                    <Text key={m.id} size="sm" c="dimmed">{m.name || 'Unnamed'} • {m.email}</Text>
                  ))}
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : !loading ? (
          <Text ta="center" c="dimmed">No unclaimed accounts.</Text>
        ) : null}
      </Box>
    </Stack>
  );
}
