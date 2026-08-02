"use client";

import { useState, useEffect } from "react";
import { Badge, Card, Center, Checkbox, Group, Stack, Table, Text, Title } from "@mantine/core";
import { PageLoader } from "@/components/ui/PageLoader";

type ProgramRef = { id: number; name: string };
type Row = {
  personId: number;
  name: string;
  householdId: number;
  householdName: string | null;
  dateOfBirth: string;
  ageAtCurrent: number;
  ageAtNext: number;
  programs: ProgramRef[];
};
type Payload = {
  currentYearStart: string | null;
  nextYearStart: string | null;
  rows: Row[];
  unknownDobCount: number;
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC" });

/**
 * Membership Audit view: non-lead household members who are 18+ as of the current
 * member-year start and as of the next one, so the board can act on both the
 * standing adults and the ones aging in. Read-only.
 */
export default function TurningEighteenPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [enrolledOnly, setEnrolledOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/membership-audit/turning-18");
        if (res.ok) {
          setData(await res.json());
        } else {
          setError("Failed to load the roster. Ensure you have the proper authorizations.");
        }
      } catch (e) {
        console.error("Failed to load the 18+ roster:", e);
        setError("Network error loading the roster.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <PageLoader />;

  if (error || !data) {
    return (
      <Center mih="60vh">
        <Title order={3} c="red">{error || "No data."}</Title>
      </Center>
    );
  }

  if (!data.currentYearStart || !data.nextYearStart) {
    return (
      <Card withBorder radius="md" padding="lg">
        <Text c="dimmed">
          No membership-year start date is configured, so there is no boundary to judge
          ages against. Set it in Settings → Membership.
        </Text>
      </Card>
    );
  }

  const rows = enrolledOnly ? data.rows.filter((r) => r.programs.length > 0) : data.rows;

  return (
    <Stack>
      <Card withBorder radius="md" padding="lg">
        <Text c="dimmed">
          Household members (excluding household leads) who are 18 or older as of{" "}
          <strong>{fmt(data.currentYearStart)}</strong> — the current member year — or as of{" "}
          <strong>{fmt(data.nextYearStart)}</strong>, the next one. Someone 18 only in the
          &ldquo;next&rdquo; column ages in on that boundary. Read-only.
        </Text>
        {data.unknownDobCount > 0 && (
          <Text size="sm" c="orange" mt="xs">
            {data.unknownDobCount} household{" "}
            {data.unknownDobCount === 1 ? "member has" : "members have"} no date of birth on
            file and could not be judged.
          </Text>
        )}
      </Card>

      <Checkbox
        label="Hide those not in a program"
        checked={enrolledOnly}
        onChange={(e) => setEnrolledOnly(e.currentTarget.checked)}
      />

      {rows.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">
            {enrolledOnly && data.rows.length > 0
              ? "Nobody on this list is enrolled in a program."
              : "Nobody turns 18 by the next member year."}
          </Text>
        </Card>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Household</Table.Th>
                <Table.Th>Date of birth</Table.Th>
                <Table.Th>Age {fmt(data.currentYearStart)}</Table.Th>
                <Table.Th>Age {fmt(data.nextYearStart)}</Table.Th>
                <Table.Th>Programs</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.personId}>
                  <Table.Td fw={600}>{r.name}</Table.Td>
                  <Table.Td>{r.householdName || `Household #${r.householdId}`}</Table.Td>
                  <Table.Td>{fmt(r.dateOfBirth)}</Table.Td>
                  <Table.Td>
                    {r.ageAtCurrent >= 18 ? (
                      r.ageAtCurrent
                    ) : (
                      <Text span c="dimmed">{r.ageAtCurrent}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {r.ageAtNext}
                      {r.ageAtCurrent < 18 && <Badge color="orange" variant="light">Turns 18</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {r.programs.length > 0 ? (
                      <Group gap={6}>
                        {r.programs.map((p) => (
                          <Badge key={p.id} variant="light">{p.name}</Badge>
                        ))}
                      </Group>
                    ) : (
                      <Text span c="dimmed">Not in a program</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
