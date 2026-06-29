"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, Center, Checkbox, Group, Loader, Stack, Table, Text, TextInput, Title } from "@mantine/core";

type OneTimeEvent = {
  id: number;
  name: string;
  start: string;
  end: string;
  description: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function OneTimeEventsList() {
  const [events, setEvents] = useState<OneTimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [futureOnly, setFutureOnly] = useState(true);
  // Snapshot "now" once on mount — Date.now() is impure and can't run during render.
  const [now] = useState(() => Date.now());
  const router = useRouter();

  useEffect(() => {
    fetch("/api/events")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (futureOnly && new Date(e.end).getTime() < now) return false;
      if (!q) return true;
      // Search across name, description, and the displayed date strings.
      const hay = [e.name, e.description ?? "", fmt(e.start), fmt(e.end)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [events, search, futureOnly, now]);

  return (
    <Stack>
      <div>
        <Title order={1}>One Time Events</Title>
        <Text c="dimmed">Browse all one-off / standalone events.</Text>
      </div>

      <Group justify="space-between" align="center" wrap="wrap">
        <TextInput
          placeholder="Search events…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={320}
        />
        <Checkbox
          label="Future Only"
          checked={futureOnly}
          onChange={(e) => setFutureOnly(e.currentTarget.checked)}
        />
      </Group>

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : rows.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">No one-time events found.</Text>
        </Card>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Start</Table.Th>
                <Table.Th>End</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((e) => (
                <Table.Tr
                  key={e.id}
                  onClick={() => router.push(`/admin/events/${e.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td>{e.name}</Table.Td>
                  <Table.Td>{fmt(e.start)}</Table.Td>
                  <Table.Td>{fmt(e.end)}</Table.Td>
                  <Table.Td>{e.description || "—"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
