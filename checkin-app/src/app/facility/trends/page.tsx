"use client";

import { useState, useEffect } from "react";
import { Card, Center, Group, Loader, SegmentedControl, Select, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";

type PeriodType = "week" | "month" | "quarter" | "year";

interface TrendBucket {
  label: string;
  periodStart: string;
  uniqueVolunteers: number;
  uniqueStudents: number;
  totalVolunteerHours: number;
  totalStudentHours: number;
  structuredHours: number;
  unstructuredHours: number;
}

interface ProgramOption {
  id: number;
  name: string;
}

export default function ParticipationTrendsPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember']);

  const [period, setPeriod] = useState<PeriodType>("month");
  const [programId, setProgramId] = useState<string>("");
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [buckets, setBuckets] = useState<TrendBucket[]>([]);
  const [totals, setTotals] = useState<TrendBucket | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch programs for the dropdown
  useEffect(() => {
    fetch("/api/programs")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setPrograms(data.map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
        }
      })
      .catch(console.error);
  }, []);

  // Fetch trends data
  useEffect(() => {
    if (!ready) return;

    const params = new URLSearchParams({ period });
    if (programId) params.set("programId", programId);

    fetch(`/api/admin/trends?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setBuckets(data.buckets || []);
        setTotals(data.totals || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period, programId, ready]);

  if (authLoading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  if (loading && buckets.length === 0) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  const fmtHours = (h: number) => {
    if (h === 0) return "0";
    if (h < 1) return `${Math.round(h * 60)}m`;
    return h.toFixed(1);
  };

  const stats: { value: string | number; label: string }[] = totals ? [
    { value: totals.uniqueVolunteers, label: "Unique Volunteers" },
    { value: totals.uniqueStudents, label: "Unique Students" },
    { value: fmtHours(totals.totalVolunteerHours), label: "Volunteer Hours" },
    { value: fmtHours(totals.totalStudentHours), label: "Student Hours" },
    { value: fmtHours(totals.structuredHours), label: "Program Hours" },
    { value: fmtHours(totals.unstructuredHours), label: "Unstructured Hours" },
  ] : [];

  return (
    <Stack>
      <Text c="dimmed">Facility usage metrics across time periods and programs.</Text>

      <Group justify="space-between" wrap="wrap">
        <SegmentedControl
          value={period}
          onChange={(v) => setPeriod(v as PeriodType)}
          data={[
            { label: "Week", value: "week" },
            { label: "Month", value: "month" },
            { label: "Quarter", value: "quarter" },
            { label: "Year", value: "year" },
          ]}
        />
        <Select
          value={programId}
          onChange={(v) => setProgramId(v ?? "")}
          allowDeselect={false}
          w={280}
          data={[
            { value: "", label: "All Programs (Aggregate)" },
            ...programs.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
      </Group>

      {totals && (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
          {stats.map((s) => (
            <Card key={s.label} withBorder radius="md" padding="md" ta="center">
              <Text fz="xl" fw={800}>{s.value}</Text>
              <Text size="xs" c="dimmed" tt="uppercase">{s.label}</Text>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Volunteers</Table.Th>
              <Table.Th>Students</Table.Th>
              <Table.Th>Vol. Hours</Table.Th>
              <Table.Th>Stu. Hours</Table.Th>
              <Table.Th>Program</Table.Th>
              <Table.Th>Unstructured</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {buckets.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7} ta="center">
                  <Text c="dimmed" py="md">No visit data found for this time range.</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              buckets.map((b) => (
                <Table.Tr key={b.periodStart}>
                  <Table.Td>{b.label}</Table.Td>
                  <Table.Td>{b.uniqueVolunteers}</Table.Td>
                  <Table.Td>{b.uniqueStudents}</Table.Td>
                  <Table.Td>{fmtHours(b.totalVolunteerHours)}</Table.Td>
                  <Table.Td>{fmtHours(b.totalStudentHours)}</Table.Td>
                  <Table.Td>{fmtHours(b.structuredHours)}</Table.Td>
                  <Table.Td>{fmtHours(b.unstructuredHours)}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
          {totals && buckets.length > 0 && (
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th>Total</Table.Th>
                <Table.Th>{totals.uniqueVolunteers}</Table.Th>
                <Table.Th>{totals.uniqueStudents}</Table.Th>
                <Table.Th>{fmtHours(totals.totalVolunteerHours)}</Table.Th>
                <Table.Th>{fmtHours(totals.totalStudentHours)}</Table.Th>
                <Table.Th>{fmtHours(totals.structuredHours)}</Table.Th>
                <Table.Th>{fmtHours(totals.unstructuredHours)}</Table.Th>
              </Table.Tr>
            </Table.Tfoot>
          )}
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
