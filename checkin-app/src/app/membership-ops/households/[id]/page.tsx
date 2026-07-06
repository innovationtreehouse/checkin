"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRequireRole } from "@/hooks/useRequireRole";
import { PageLoader } from "@/components/ui/PageLoader";

type Enrollment = {
  status: "PENDING" | "ACTIVE";
  program: { id: number; name: string };
};
type Member = {
  id: number;
  name?: string | null;
  email?: string | null;
  programParticipants?: Enrollment[] | null;
};
type Household = {
  id: number;
  name?: string | null;
  orgMembership?: { status: string } | null;
  householdMembers?: Member[] | null;
};

// A household detail view for the board — its members and each member's program
// enrollments in one focused screen, off the noisy households list.
export default function HouseholdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, loading: authLoading } = useRequireRole(["isSysadmin", "isBoardMember"]);
  const router = useRouter();

  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHousehold = useCallback(async () => {
    try {
      const res = await fetch(`/api/membership-ops/households?id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setHousehold(data.household);
      } else {
        notifications.show({ color: "red", message: "Failed to load household.", autoClose: false });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) fetchHousehold();
  }, [ready, fetchHousehold]);

  if (authLoading || loading) return <PageLoader />;
  if (!ready) return null;

  if (!household) {
    return (
      <Stack>
        <Button variant="subtle" onClick={() => router.push("/membership-ops/households")} w="fit-content">
          ← Back to Households
        </Button>
        <Text c="dimmed">Household not found.</Text>
      </Stack>
    );
  }

  const status = household.orgMembership?.status;
  const members = household.householdMembers ?? [];

  return (
    <Stack>
      <Button variant="subtle" onClick={() => router.push("/membership-ops/households")} w="fit-content">
        ← Back to Households
      </Button>

      <Group justify="space-between" align="center">
        <Title order={3}>{household.name || `Household #${household.id}`}</Title>
        {status === "DENIED" ? (
          <Badge color="red">Denied</Badge>
        ) : status === "ACTIVE" ? (
          <Badge color="green">Member</Badge>
        ) : (
          <Badge color="gray">Not a member</Badge>
        )}
      </Group>

      {members.length === 0 ? (
        <Text c="dimmed" fs="italic">No people in this household.</Text>
      ) : (
        <Stack gap="sm">
          {members.map((m) => {
            const enrollments = m.programParticipants ?? [];
            return (
              <Card key={m.id} withBorder padding="md">
                <Text fw={600}>{m.name || m.email}</Text>
                {enrollments.length === 0 ? (
                  <Text size="sm" c="dimmed" fs="italic" mt={4}>Not enrolled in any program.</Text>
                ) : (
                  <Group gap="xs" mt="xs">
                    {enrollments.map((e) => (
                      <Badge
                        key={e.program.id}
                        variant="light"
                        color={e.status === "ACTIVE" ? "green" : "yellow"}
                        style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/program-ops/programs/${e.program.id}`)}
                      >
                        {e.program.name}{e.status === "PENDING" ? " (pending)" : ""}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
