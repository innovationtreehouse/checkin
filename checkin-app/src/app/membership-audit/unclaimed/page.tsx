"use client";

import { useState, useEffect } from "react";
import { Box, Card, Stack, Text } from "@mantine/core";

type UnclaimedHousehold = {
  id: number;
  name: string;
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
    <Stack>
      <div>
        <Text c="dimmed">Households where no household lead has ever signed in with Google.</Text>
      </div>

      <Box>
        {households.length > 0 ? (
          <Stack gap="sm">
            {households.map((h) => (
              <Card key={h.id} withBorder radius="md" padding="md">
                <Text fw={600} mb="xs">{h.name}</Text>
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
