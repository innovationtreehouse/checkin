"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Checkbox, Container, Group, Modal, Stack, Switch, Text, Textarea, TextInput, Title } from "@mantine/core";
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
  orgMembership: { household: { name: string | null; intakeNotes: string | null; householdMembers: Person[] } | null } | null;
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
  // Optional "check completed on a different date" per row — the slider gate + the
  // picked YYYY-MM-DD. Off by default → the check is stamped as of clearance time.
  const [customDateOn, setCustomDateOn] = useState<Record<number, boolean>>({});
  const [customDate, setCustomDate] = useState<Record<number, string>>({});
  // Confirmation modal: the attestation about to be submitted for `processId`,
  // carrying the exact completion date being attested (null = as of today).
  const [confirm, setConfirm] = useState<{ processId: number; date: string | null } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
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

  // Submit one attestation. Returns { mismatch } ONLY when the server reports a
  // date_mismatch (value = the date the first reviewer attested to, null = today),
  // so the caller can open the modal to make this reviewer confirm that date.
  const finishAttest = async (
    processId: number,
    result: "APPROVE" | "REJECT",
    checkDate: string | null,
  ): Promise<{ mismatch?: string | null }> => {
    setBusyId(processId);
    setMessage(undefined);
    try {
      const res = await fetch("/api/membership/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, result, isMarkedVolunteer: !!volunteer[processId], note: reviewNotes[processId]?.trim() || undefined, checkDate: checkDate || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notifications.show({ message: result === "APPROVE" ? "Attestation recorded — thank you." : "Recorded. The board has been notified." });
        await load();
        notifyNavRefresh();
        return {};
      }
      if (data.code === "date_mismatch") return { mismatch: data.requiredCheckDate ?? null };
      if (data.code === "already_attested") {
        notifications.show({ color: "red", message: data.error || "Already attested.", autoClose: 4000 });
        await load();
        return {};
      }
      setMessage({ processId, text: data.error || "Could not record your attestation.", tone: "error" });
      return {};
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
      return {};
    } finally {
      setBusyId(null);
    }
  };

  // Approve: a custom date always goes through the confirmation modal first. Without
  // one, submit as-of-today — and if the server says the FIRST reviewer already
  // attested a specific date, open the modal so this (second) reviewer confirms it.
  const onApprove = async (processId: number) => {
    if (customDateOn[processId] && customDate[processId]) {
      setConfirm({ processId, date: customDate[processId] });
      return;
    }
    const { mismatch } = await finishAttest(processId, "APPROVE", null);
    if (mismatch !== undefined) setConfirm({ processId, date: mismatch });
  };

  const reject = (processId: number) => {
    if (!reviewNotes[processId]?.trim()) return;
    void finishAttest(processId, "REJECT", null);
  };

  const confirmApprove = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    const { mismatch } = await finishAttest(confirm.processId, "APPROVE", confirm.date);
    setConfirmBusy(false);
    // Still mismatched → the required date differs from what was just confirmed;
    // retarget the modal to the date the first reviewer actually attested to.
    if (mismatch !== undefined) setConfirm({ processId: confirm.processId, date: mismatch });
    else setConfirm(null);
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
            const parents = item.orgMembership?.household?.householdMembers ?? [];
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

              <Textarea
                mt="md"
                label="Notes"
                placeholder="Optional for approval, required for rejection"
                value={reviewNotes[item.id] ?? ""}
                onChange={(e) => { const value = e.currentTarget.value; setReviewNotes((n) => ({ ...n, [item.id]: value })); }}
                autosize
                minRows={2}
              />

              {/* Optional backdating. Off → the check is stamped as of clearance.
                  On → a completion date the reviewer attests to; a confirmation
                  modal (on Approve) makes them attest to it, and the SECOND reviewer
                  must attest to the SAME date (enforced server-side). */}
              <Switch
                mt="md"
                checked={!!customDateOn[item.id]}
                onChange={(e) => { const on = e.currentTarget.checked; setCustomDateOn((s) => ({ ...s, [item.id]: on })); }}
                label="This background check was completed on a different date"
              />
              {customDateOn[item.id] && (
                <TextInput
                  type="date"
                  mt="xs"
                  max={today}
                  label="Completion date"
                  description="Both reviewers must attest to this date. You'll confirm it before approving."
                  value={customDate[item.id] ?? ""}
                  onChange={(e) => { const v = e.currentTarget.value; setCustomDate((s) => ({ ...s, [item.id]: v })); }}
                />
              )}

              <Group gap="sm" wrap="wrap" mt="md">
                <Button
                  disabled={busyId === item.id || (!!customDateOn[item.id] && !customDate[item.id])}
                  loading={busyId === item.id}
                  onClick={() => onApprove(item.id)}
                >
                  Attest — check is clean
                </Button>
                <Button color="red" variant="light" disabled={busyId === item.id || !reviewNotes[item.id]?.trim()} onClick={() => reject(item.id)}>
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

      {/* Date attestation confirmation. Opened when a reviewer sets a custom date,
          or when the server requires the second reviewer to confirm the first's
          date. Confirming records THIS reviewer's attestation to that exact date. */}
      <Modal
        opened={!!confirm}
        onClose={() => { if (!confirmBusy) setConfirm(null); }}
        title="Confirm the background-check date"
        centered
      >
        <Text>
          {confirm?.date ? (
            <>You are attesting that this background check was <strong>completed on {confirm.date}</strong> and that it is clean.</>
          ) : (
            <>The first reviewer attested this check <strong>as of today</strong>. Confirm you attest to today&apos;s date and a clean check.</>
          )}
        </Text>
        <Text size="sm" c="dimmed" mt="sm">
          Both reviewers must attest to the same date. This is recorded as your attestation.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirm(null)} disabled={confirmBusy}>Cancel</Button>
          <Button onClick={confirmApprove} loading={confirmBusy}>
            Attest — check is clean{confirm?.date ? ` (${confirm.date})` : ""}
          </Button>
        </Group>
      </Modal>
    </Container>
  );
}
