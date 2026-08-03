"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Checkbox, Container, Group, Stack, Text, Textarea, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
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
  orgMembership: { household: { name: string | null; intakeNotes: string | null; householdMembers: Person[] } | null } | null;
  // Subject ids only — enough to count approvals per lead, and it says nothing
  // about WHO approved (see the route comment).
  attestations: { subjectPersonId: number | null }[];
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
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  // processId -> the household leads whose reports this reviewer is attesting to.
  const [subjects, setSubjects] = useState<Record<number, number[]>>({});
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
    if (result === "REJECT" && !reviewNotes[processId]?.trim()) return;
    setBusyId(processId);
    setMessage(undefined);
    try {
      const res = await fetch("/api/membership/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, result, isMarkedVolunteer: !!volunteer[processId], note: reviewNotes[processId]?.trim() || undefined, subjectPersonIds: subjects[processId] ?? [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notifications.show({ message: result === "APPROVE" ? "Attestation recorded — thank you." : "Recorded. The board has been notified." });
        setSubjects((s) => ({ ...s, [processId]: [] }));
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

  // Who this review is about — the PERSON_BG subject, else the applicant household.
  const applicantLabel = (item: QueueItem) =>
    item.subjectPerson
      ? item.subjectPerson.name || `Person #${item.subjectPerson.id}`
      : item.orgMembership?.household?.name || `Household (application #${item.id})`;

  // Approvals a household lead already has, from other reviewers' attestations.
  const approvalsFor = (item: QueueItem, personId: number) =>
    item.attestations.filter((a) => a.subjectPersonId === personId).length;

  const selected = (item: QueueItem) => subjects[item.id] ?? [];

  const toggleSubject = (processId: number, personId: number, checked: boolean) =>
    setSubjects((s) => {
      const current = s[processId] ?? [];
      return { ...s, [processId]: checked ? [...current, personId] : current.filter((id) => id !== personId) };
    });

  // Attesting is a one-click, two-of-two decision, and the SECOND approval on a named
  // adult clears the check outright — stamping that adult, opening payment or
  // activating, and emailing the family. Confirm both actions, and say what the click
  // actually does rather than "are you sure?", which trains people to click through.
  const confirmSubmit = (item: QueueItem, result: "APPROVE" | "REJECT") => {
    const who = applicantLabel(item);
    // A household clears the moment one named adult reaches two approvals.
    const clearing =
      result === "APPROVE" &&
      (item.subjectPerson
        ? item._count.attestations >= 1
        : selected(item).some((id) => approvalsFor(item, id) >= 1));
    modals.openConfirmModal({
      title: result === "REJECT" ? "Reject this background check?" : clearing ? "Clear this background check?" : "Record your approval?",
      children: (
        <Text size="sm">
          {result === "REJECT" ? (
            <>
              This blocks <strong>{who}</strong>&apos;s membership and notifies the board. The
              applicant is not told the reason.
            </>
          ) : clearing ? (
            <>
              You are the second reviewer for <strong>{who}</strong>. This clears the background
              check, records it against the {item.subjectPerson ? "subject" : "adult(s) you named"},
              opens payment (or activates the membership if dues are already paid), and emails the
              family. It cannot be undone.
            </>
          ) : (
            <>
              This records your approval of <strong>{who}</strong>&apos;s background check
              {item.subjectPerson ? "" : " for the adult(s) you named"}. A second reviewer must also
              approve before the check clears.
            </>
          )}
        </Text>
      ),
      labels: { confirm: result === "REJECT" ? "Reject" : clearing ? "Clear the check" : "Approve", cancel: "Cancel" },
      confirmProps: { color: result === "REJECT" ? "red" : clearing ? "orange" : undefined },
      onConfirm: () => submit(item.id, result),
    });
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
        Review each applicant&apos;s background check on Averity, then attest below. Name every adult
        whose report you actually read — a check is recorded against that person and nobody else.
        Two independent reviewers are required per adult. If anything is concerning, choose{" "}
        <strong>Reject</strong> — the board is notified and the applicant is not told the reason.
      </Text>

      {queue.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center" mt="md">
          <Text c="dimmed">Nothing awaiting your review right now.</Text>
        </Card>
      ) : (
        <Stack mt="md">
          {queue.map((item) => {
            const subject = item.subjectPerson;
            const parents = item.orgMembership?.household?.householdMembers ?? [];
            const notes = item.orgMembership?.household?.intakeNotes?.trim();
            return (
            <Card key={item.id} withBorder radius="md" padding="lg">
              {subject ? (
                <>
                  <Text fw={700} fz="lg">{applicantLabel(item)}</Text>
                  <Text size="sm" c="dimmed" mt={4}>
                    Background check for an individual · {subject.household?.name ? `Household: ${subject.household.name}` : "No household on file"}
                  </Text>
                </>
              ) : (
                <>
                  <Text fw={700} fz="lg">{applicantLabel(item)}</Text>
                  <Text size="sm" c="dimmed" mt={4}>
                    {parents.length > 0
                      ? parents.map((p) => `${p.name || "—"}${p.email ? ` <${p.email}>` : ""}`).join(", ")
                      : "No parent contact on file."}
                  </Text>
                </>
              )}
              {subject && <Text size="xs" c="dimmed" mt={4}>{item._count.attestations}/2 approvals so far.</Text>}

              {/* Whose report did you read? The Averity report names its subject, and
                  that name is the only record of who a household's check covered — so
                  approving without one is refused by the server. Every live lead is
                  listed, including one that already looks checked, so a family who
                  re-checked early can still be recorded. */}
              {!subject && (
                <Stack gap={4} mt="md">
                  <Text size="sm" fw={600}>Whose check(s) did you review?</Text>
                  {parents.length === 0 ? (
                    <Text size="sm" c="dimmed">No household leads on file — this application cannot be attested.</Text>
                  ) : (
                    parents.map((p) => (
                      <Checkbox
                        key={p.id}
                        checked={selected(item).includes(p.id)}
                        onChange={(e) => toggleSubject(item.id, p.id, e.currentTarget.checked)}
                        label={`${p.name || p.email || `Person #${p.id}`} — ${approvalsFor(item, p.id)} of 2 approvals`}
                      />
                    ))
                  )}
                </Stack>
              )}

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

              <Textarea
                mt="md"
                label="Notes"
                placeholder="Optional for approval, required for rejection"
                value={reviewNotes[item.id] ?? ""}
                onChange={(e) => { const value = e.currentTarget.value; setReviewNotes((n) => ({ ...n, [item.id]: value })); }}
                autosize
                minRows={2}
              />

              <Group gap="sm" wrap="wrap" mt="md">
                <Button
                  disabled={busyId === item.id || (!subject && selected(item).length === 0)}
                  loading={busyId === item.id}
                  onClick={() => confirmSubmit(item, "APPROVE")}
                >
                  Attest — check is clean
                </Button>
                <Button color="red" variant="light" disabled={busyId === item.id || !reviewNotes[item.id]?.trim()} onClick={() => confirmSubmit(item, "REJECT")}>
                  Reject
                </Button>
              </Group>

              {message?.processId === item.id && (
                <Alert color={message.tone === "success" ? "treehouseGreen" : "red"} variant="light" mt="md">
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
