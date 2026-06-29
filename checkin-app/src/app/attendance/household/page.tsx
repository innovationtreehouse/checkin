"use client";

import { useState, useEffect } from "react";
import { Badge, Center, Group, Loader, Table, Text, TextInput, Title } from "@mantine/core";
import { PageContainer } from "@/components/ui/PageContainer";
import { useRequireRole } from "@/hooks/useRequireRole";
import { formatDate, formatVisitRange, formatDateTime } from "@/lib/time";
import { AttendanceTabs } from "../AttendanceTabs";

type Visit = { id: number; participant?: { name: string }; event?: { name: string }; arrivedAt: string; departedAt?: string };

export default function HouseholdCheckins() {
  const { ready, loading: authLoading } = useRequireRole([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [filterDate, setFilterDate] = useState("");

  useEffect(() => {
    if (!ready) return;
    let active = true;
    (async () => {
      const res = await fetch(`/api/household/visits?date=${filterDate}`);
      if (active && res.ok) {
        const data = await res.json();
        setVisits(data.visits || []);
      }
    })();
    return () => { active = false; };
  }, [ready, filterDate]);

  if (authLoading) return <Center mih="60vh"><Loader /></Center>;
  if (!ready) return null;

  return (
    <PageContainer>
      <AttendanceTabs />
      <Group justify="space-between" align="center" wrap="wrap" mb="xs">
        <Title order={1}>Household Check-ins</Title>
        <TextInput
          type="date"
          label="Lookup Date"
          size="xs"
          value={filterDate || new Date().toISOString().split('T')[0]}
          onChange={(e) => setFilterDate(e.currentTarget.value)}
        />
      </Group>

      <Text size="sm" c="dimmed" mb="lg">
        {filterDate ? (
          <>Showing activity from <strong>{formatDate(new Date(filterDate).getTime() - 7 * 24 * 60 * 60 * 1000)}</strong> to <strong>{formatDate(new Date(filterDate).getTime() + 7 * 24 * 60 * 60 * 1000)}</strong></>
        ) : (
          <>Showing activity for the <strong>past 7 days</strong></>
        )}
      </Text>

      {visits.length === 0 ? (
        <Text c="dimmed">No historical visits found for your household.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Member</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Arrived</Table.Th>
              <Table.Th>Duration</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visits.map((v) => (
              <Table.Tr key={v.id}>
                <Table.Td><Text fw={600} c="blue">{v.participant?.name || 'Unnamed Member'}</Text></Table.Td>
                <Table.Td>{v.event?.name || 'General Facility Visit'}</Table.Td>
                <Table.Td>{formatDateTime(v.arrivedAt, { dateStyle: 'short', timeStyle: 'short' })}</Table.Td>
                <Table.Td>{formatVisitRange(v.arrivedAt, v.departedAt)}</Table.Td>
                <Table.Td>{!v.departedAt && <Badge color="yellow" variant="light">Active</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </PageContainer>
  );
}
