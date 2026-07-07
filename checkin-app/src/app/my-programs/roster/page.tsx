"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Anchor, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { formatDate } from "@/lib/time";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { ProgramInfo } from "@/lib/programRoster";

/**
 * Roster subtab of staff "My Programs": for one program the caller leads, shows a
 * stats card (enrollment vs capacity, sessions, scholarship-request COUNT), the
 * participant roster with household-lead contact ("who do I call") + per-participant
 * attendance, per-session turnout, and CSV export. All data comes from the scoped
 * GET /api/my-programs/[id]; the lead-gate + loading live in layout.tsx.
 */
export default function RosterPage() {
  const { status } = useSession();
  const counts = useTodoCounts(status === "authenticated");
  const programs = counts?.lead?.programs ?? [];

  // Selection is derived: the user's pick, else the first led program. No
  // setState-in-effect to seed a default.
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? programs[0]?.id ?? null;

  const [info, setInfo] = useState<ProgramInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0); // race guard: only the latest request applies its result

  const load = useCallback(async (programId: number) => {
    const my = ++reqRef.current;
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/my-programs/${programId}`);
      const data = res.ok ? ((await res.json()) as ProgramInfo) : null;
      if (my === reqRef.current) setInfo(data);
    } catch {
      if (my === reqRef.current) setInfo(null);
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected !== null) load(selected);
  }, [selected, load]);

  if (programs.length === 0) return null; // layout shows loader / redirects non-leads

  return (
    <Stack>
      {programs.length > 1 && (
        <Select
          label="Program"
          data={programs.map((p) => ({ value: String(p.id), label: p.name }))}
          value={selected === null ? null : String(selected)}
          onChange={(v) => setPicked(v ? Number(v) : null)}
          allowDeselect={false}
          maw={360}
        />
      )}

      {loading && info === null ? (
        <Text c="dimmed">Loading roster…</Text>
      ) : info === null ? (
        <Text c="dimmed">Could not load this program.</Text>
      ) : (
        <ProgramInfoView info={info} />
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
      <Text fw={700} size="xl">{value}</Text>
    </Card>
  );
}

function ProgramInfoView({ info }: { info: ProgramInfo }) {
  const { program, roster, events } = info;
  const enrollment = program.capacity != null ? `${program.enrolled} / ${program.capacity}` : String(program.enrolled);
  const csvHref = (kind: "roster" | "events") => `/api/my-programs/${program.id}?format=csv&kind=${kind}`;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Title order={3}>{program.name}</Title>
        <Group gap="xs">
          <Button component="a" href={csvHref("roster")} variant="light" size="xs" leftSection={<IconDownload size={14} />}>
            Roster CSV
          </Button>
          <Button component="a" href={csvHref("events")} variant="light" size="xs" leftSection={<IconDownload size={14} />}>
            Attendance CSV
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Enrolled" value={enrollment} />
        <Stat label="Pending" value={program.pending} />
        <Stat label="Sessions" value={program.eventCount} />
        <Stat label="Scholarship requests" value={program.scholarshipRequests} />
      </SimpleGrid>

      <Card withBorder radius="md" padding="lg">
        <Text fw={600} mb="sm">Roster ({roster.length})</Text>
        {roster.length === 0 ? (
          <Text c="dimmed" size="sm">No participants yet.</Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Participant</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Household lead</Table.Th>
                  <Table.Th>Contact</Table.Th>
                  <Table.Th>Attended</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {roster.map((r) => (
                  <Table.Tr key={r.personId}>
                    <Table.Td>{r.name}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={r.status === "ACTIVE" ? "treehouseGreen" : "yellow"}>
                        {r.status === "ACTIVE" ? "Enrolled" : "Pending"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{r.contact?.name || <Text c="dimmed" size="sm">—</Text>}</Table.Td>
                    <Table.Td>
                      <Stack gap={0}>
                        {r.contact?.email && <Anchor href={`mailto:${r.contact.email}`} size="sm">{r.contact.email}</Anchor>}
                        {r.contact?.phone && <Anchor href={`tel:${r.contact.phone}`} size="sm">{r.contact.phone}</Anchor>}
                        {!r.contact?.email && !r.contact?.phone && <Text c="dimmed" size="sm">—</Text>}
                      </Stack>
                    </Table.Td>
                    <Table.Td>{r.attendanceCount}</Table.Td>
                    <Table.Td>{r.lastSeenAt ? formatDate(r.lastSeenAt) : <Text c="dimmed" size="sm">never</Text>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Text fw={600} mb="sm">Session turnout</Text>
        {events.length === 0 ? (
          <Text c="dimmed" size="sm">No sessions yet.</Text>
        ) : (
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Session</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Turnout</Table.Th>
                <Table.Th>Confirmed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.map((e) => (
                <Table.Tr key={e.eventId}>
                  <Table.Td>{e.name}</Table.Td>
                  <Table.Td>{formatDate(e.startAt)}</Table.Td>
                  <Table.Td>{e.turnout}</Table.Td>
                  <Table.Td>
                    {e.attendanceConfirmedAt
                      ? <Badge variant="light" color="treehouseGreen">Yes</Badge>
                      : <Badge variant="light" color="gray">No</Badge>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
