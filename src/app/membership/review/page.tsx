"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Center, Checkbox, Container, Group, Loader, Stack, Text, Title } from "@mantine/core";

interface QueueItem {
  processId: number;
  householdName: string | null;
  parents: { name: string | null; email: string | null }[];
  approvals: number;
}

export default function MembershipReviewPage() {
  const { status: sessionStatus } = useSession();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [volunteer, setVolunteer] = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/membership/reviews");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") load();
    else if (sessionStatus === "unauthenticated") setLoading(false);
  }, [sessionStatus, load]);

  const submit = async (processId: number, result: "APPROVE" | "REJECT") => {
    setBusyId(processId);
    setMessage("");
    try {
      const res = await fetch("/api/membership/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, result, markedVolunteer: !!volunteer[processId] }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsError(false);
        setMessage(result === "APPROVE" ? "Attestation recorded — thank you." : "Recorded. The board has been notified.");
        await load();
      } else {
        setIsError(true);
        setMessage(data.error || "Could not record your attestation.");
      }
    } catch {
      setIsError(true);
      setMessage("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  if (sessionStatus === "loading" || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (forbidden || sessionStatus === "unauthenticated") {
    return (
      <Container size="xs" py="xl">
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={2}>Background-check review</Title>
          <Text c="dimmed" my="md">This area is for background-check reviewers only.</Text>
          <Button component={Link} href="/">Home</Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" py="md">
      <Group justify="space-between" align="center" wrap="wrap" mb="md">
        <Title order={1}>Background-check review</Title>
        <Button component={Link} href="/" variant="default">← Home</Button>
      </Group>

      <Text c="dimmed">
        Review each applicant&apos;s background check on Averity, then attest below. Two independent
        reviewers are required. If anything is concerning, choose <strong>Reject</strong> — the
        board is notified and the applicant is not told the reason.
      </Text>

      {message && <Alert color={isError ? "red" : "green"} mt="md">{message}</Alert>}

      {queue.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center" mt="md">
          <Text c="dimmed">Nothing awaiting your review right now.</Text>
        </Card>
      ) : (
        <Stack mt="md">
          {queue.map((item) => (
            <Card key={item.processId} withBorder radius="md" padding="lg">
              <Text fw={700} fz="lg">
                {item.householdName || `Household (application #${item.processId})`}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {item.parents.length > 0
                  ? item.parents.map((p) => `${p.name || "—"}${p.email ? ` <${p.email}>` : ""}`).join(", ")
                  : "No parent contact on file."}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>{item.approvals}/2 approvals so far.</Text>

              <Checkbox
                my="md"
                checked={!!volunteer[item.processId]}
                onChange={(e) => setVolunteer((v) => ({ ...v, [item.processId]: e.currentTarget.checked }))}
                label="This is a volunteer family"
              />

              <Group gap="sm" wrap="wrap">
                <Button color="green" disabled={busyId === item.processId} loading={busyId === item.processId} onClick={() => submit(item.processId, "APPROVE")}>
                  Attest — check is clean
                </Button>
                <Button color="red" variant="light" disabled={busyId === item.processId} onClick={() => submit(item.processId, "REJECT")}>
                  Reject
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Container>
  );
}
