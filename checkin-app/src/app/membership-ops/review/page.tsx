"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Checkbox, Container, Group, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type AlertTone } from "@/components/admin/AlertBanner";
import { notifyNavRefresh } from "@/lib/nav-refresh";

import { PageLoader } from "@/components/ui/PageLoader";
interface Person {
    id: number;
    name: string | null;
    email: string | null;
}
// Shape returned by GET /api/membership/reviews (security-stripped model rows).
// A household review returns the leads (parents); a PERSON_BG review returns the
// subject person (name + household context) instead. Children are never sent.
interface QueueItem {
  id: number;
  subjectPerson: { id: number; name: string | null; householdId: number | null; household: { name: string | null } | null } | null;
  orgMembership: { household: { name: string | null; intakeNotes: string | null; leads: { person: Person }[] } | null } | null;
  _count: { attestations: number };
}

export default function MembershipReviewPage() {
  const { status: sessionStatus } = useSession();
  // No h1 here: this page always renders inside the Membership Ops layout, whose
  // tab bar already labels it (the standalone /membership/review route is gone).
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [volunteer, setVolunteer] = useState<Record<number, boolean>>({});
  // Tagged with the acting row's processId so the result renders in that card, not off-screen at page top.
  const [message, setMessage] = useState<{ processId: number; text: string; tone: AlertTone } | undefined>();

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
    setMessage(undefined);
    try {
      const res = await fetch("/api/membership/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, result, isMarkedVolunteer: !!volunteer[processId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notifications.show({ color: "green", message: result === "APPROVE" ? "Attestation recorded — thank you." : "Recorded. The board has been notified." });
        await load();
        notifyNavRefresh();
      } else if (data.code === "already_attested") {
        notifications.show({ color: "red", message: data.error || "Already attested.", autoClose: 4000 });
        await load();
      } else {
        setMessage({ processId, text: data.error || "Could not record your attestation.", tone: "error" });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
    } finally {
      setBusyId(null);
    }
  };

  if (sessionStatus === "loading" || loading) {
    return <PageLoader />;
  }

  if (forbidden || sessionStatus === "unauthenticated") {
    return (
      <Container size="xs" py="xl">
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={2}>Background-check review</Title>
          <Text c="dimmed" my="md">This area is for background-check reviewers only.</Text>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" pb="md">
      <Text c="dimmed">
        Review each applicant&apos;s background check on Averity, then attest below. Two independent
        reviewers are required. If anything is concerning, choose <strong>Reject</strong> — the
        board is notified and the applicant is not told the reason.
      </Text>

      {queue.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center" mt="md">
          <Text c="dimmed">Nothing awaiting your review right now.</Text>
        </Card>
      ) : (
        <Stack mt="md">
          {queue.map((item) => {
            const subject = item.subjectPerson;
            const parents = (item.orgMembership?.household?.leads ?? []).map((l) => l.person);
            const notes = item.orgMembership?.household?.intakeNotes?.trim();
            return (
            <Card key={item.id} withBorder radius="md" padding="lg">
              {subject ? (
                <>
                  <Text fw={700} fz="lg">{subject.name || `Person #${subject.id}`}</Text>
                  <Text size="sm" c="dimmed" mt={4}>
                    Background check for an individual · {subject.household?.name ? `Household: ${subject.household.name}` : "No household on file"}
                  </Text>
                </>
              ) : (
                <>
                  <Text fw={700} fz="lg">
                    {item.orgMembership?.household?.name || `Household (application #${item.id})`}
                  </Text>
                  <Text size="sm" c="dimmed" mt={4}>
                    {parents.length > 0
                      ? parents.map((p) => `${p.name || "—"}${p.email ? ` <${p.email}>` : ""}`).join(", ")
                      : "No parent contact on file."}
                  </Text>
                </>
              )}
              <Text size="xs" c="dimmed" mt={4}>{item._count.attestations}/2 approvals so far.</Text>

              {/* Household-application concepts (intake note + volunteer-only mark)
                  don't apply to a per-person BG check. */}
              {!subject && notes && (
                <Alert color="yellow" variant="light" mt="md" title="From the applicant — “Anything else we should know?”">
                  <Text style={{ whiteSpace: "pre-wrap" }}>{notes}</Text>
                </Alert>
              )}

              {!subject && (
                <Checkbox
                  my="md"
                  checked={!!volunteer[item.id]}
                  onChange={(e) => { const checked = e.currentTarget.checked; setVolunteer((v) => ({ ...v, [item.id]: checked })); }}
                  label="This is a volunteer only family (no students)"
                />
              )}

              <Group gap="sm" wrap="wrap" mt={subject ? "md" : undefined}>
                <Button color="green" disabled={busyId === item.id} loading={busyId === item.id} onClick={() => submit(item.id, "APPROVE")}>
                  Attest — check is clean
                </Button>
                <Button color="red" variant="light" disabled={busyId === item.id} onClick={() => submit(item.id, "REJECT")}>
                  Reject
                </Button>
              </Group>

              {message?.processId === item.id && (
                <Alert color={message.tone === "success" ? "green" : "red"} variant="light" mt="md">
                  {message.text}
                </Alert>
              )}
            </Card>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
