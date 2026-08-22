"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge, Card, Center, Stack, Table, Text, Title } from "@mantine/core";
import { formatDateOnly } from "@/lib/time";
import { PageLoader } from "@/components/ui/PageLoader";

type Attestation = {
  id: number;
  result: "APPROVE" | "REJECT";
  note: string | null;
  isMarkedVolunteer: boolean;
  createdAt: string;
  reviewerName: string;
  subjectName: string | null;
  householdId: number | null;
  householdName: string | null;
  processId: number;
  processKind: string;
  processStatus: string;
  cleared: boolean;
};

const KIND_LABEL: Record<string, string> = {
  INITIAL: "Initial",
  RENEWAL: "Renewal",
  PERSON_BG: "Individual",
};

export default function BgAttestationsPage() {
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/membership-audit/bg-attestations");
      if (res.ok) {
        const data = await res.json();
        setAttestations(data.attestations ?? []);
      } else {
        setError("Failed to load attestation data.");
      }
    } catch {
      setError("Network error loading attestation data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoader />;
  if (error) return <Center mih="60vh"><Title order={3} c="red">{error}</Title></Center>;

  return (
    <Stack>
      <Card withBorder radius="md" padding="lg">
        <Text c="dimmed">
          Every background-check attestation on record — who reviewed, who was checked, and the
          outcome. Newest first.
        </Text>
      </Card>

      {attestations.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">No attestations on record.</Text>
        </Card>
      ) : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Reviewer</Table.Th>
                <Table.Th>Subject</Table.Th>
                <Table.Th>Household</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Result</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {attestations.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDateOnly(a.createdAt)}</Table.Td>
                  <Table.Td>{a.reviewerName}</Table.Td>
                  <Table.Td>{a.subjectName || <Text span c="dimmed">—</Text>}</Table.Td>
                  <Table.Td>{a.householdName || <Text span c="dimmed">—</Text>}</Table.Td>
                  <Table.Td>{KIND_LABEL[a.processKind] ?? a.processKind}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={a.result === "APPROVE" ? "green" : "red"}
                      variant="light"
                      size="sm"
                    >
                      {a.result === "APPROVE" ? "Approved" : "Rejected"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {a.cleared ? (
                      <Badge color="green" variant="light" size="sm">Cleared</Badge>
                    ) : a.processStatus === "BLOCKED" ? (
                      <Badge color="red" variant="light" size="sm">Blocked</Badge>
                    ) : (
                      <Badge color="gray" variant="light" size="sm">Pending</Badge>
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
