"use client";

import { useState, useEffect, useCallback } from "react";
import { Alert, Badge, Button, Card, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { AlertBanner } from "@/components/admin/AlertBanner";
import { notifications } from "@mantine/notifications";
import { notifyNavRefresh } from "@/lib/nav-refresh";

interface Person {
  id: number;
  name: string | null;
  email: string | null;
}
interface Attestation {
  id: number;
  result: string;
  isMarkedVolunteer: boolean;
}
interface ProcessRow {
  id: number;
  kind: string;
  status: string;
  createdAt: string;
  zohoEnvelopeId: string | null;
  contractSignedAt: string | null;
  bgConsentAt: string | null;
  bgClearedAt: string | null;
  paidAt: string | null;
  attestations: Attestation[];
  orgMembership: {
    householdId: number;
    isVolunteer: boolean;
    household: { name: string | null; householdMembers: Person[]; leads: { personId: number }[] } | null;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  INTAKE: "gray",
  PENDING_EXTERNAL_ACTION: "blue",
  PENDING_BG_REVIEW: "grape",
  PENDING_PAYMENT: "orange",
  PENDING_BG_CLEARANCE: "grape",
  BLOCKED: "red",
  PENDING_RENEWAL: "teal",
  RENEWAL_PENDING_BG: "grape",
};

const statusColor = (status: string) => STATUS_COLORS[status] || "gray";
const statusLabel = (status: string) => status.replace(/_/g, " ");

// The background check is a parallel track: an application still needs review
// when it hasn't cleared and is past consent (mirrors review.ts isAwaitingBgReview).
const awaitingBg = (r: ProcessRow) =>
  !r.bgClearedAt &&
  (r.status === "PENDING_BG_REVIEW" ||
    r.status === "RENEWAL_PENDING_BG" ||
    ((r.status === "PENDING_PAYMENT" || r.status === "PENDING_BG_CLEARANCE") && !!r.bgConsentAt));

export default function AdminMembershipPage() {
  const [rows, setRows] = useState<ProcessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [messageId, setMessageId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/membership-ops/applications");
      if (res.ok) {
        const data = await res.json();
        setRows(data.processes || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (processId: number, action: string, extra?: Record<string, unknown>) => {
    setBusyId(processId);
    setMessageId(processId);
    setMessage("");
    try {
      const res = await fetch("/api/membership-ops/applications/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, action, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        notifications.show({ color: "green", message: "Updated." });
        await load();
        notifyNavRefresh();
      } else {
        setMessage(data.error || "Action failed.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  const override = async (processId: number, action: "reset" | "approve") => {
    setBusyId(processId);
    setMessageId(processId);
    setMessage("");
    try {
      const res = await fetch("/api/membership-ops/applications/review-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, action }),
      });
      const data = await res.json();
      if (res.ok) {
        notifications.show({ color: "green", message: action === "reset" ? "Sent back for re-review." : "Overridden to payment." });
        await load();
        notifyNavRefresh();
      } else {
        setMessage(data.error || "Override failed.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  const certify = async (processId: number) => {
    setBusyId(processId);
    setMessageId(processId);
    setMessage("");
    try {
      const res = await fetch("/api/membership-ops/applications/certify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId }),
      });
      const data = await res.json();
      if (res.ok) {
        notifications.show({ color: "green", message: "Certified — membership activated." });
        await load();
        notifyNavRefresh();
      } else {
        setMessage(data.error || "Certification failed.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setBusyId(null);
    }
  };

  const householdLabel = (r: ProcessRow) => {
    const hh = r.orgMembership?.household;
    if (!hh) return `Household #${r.orgMembership?.householdId ?? "?"}`;
    const leadIds = new Set((hh.leads || []).map((l) => l.personId));
    const parents = (hh.householdMembers || []).filter((p) => leadIds.has(p.id)).map((p) => p.name || p.email).filter(Boolean);
    return hh.name || parents.join(" & ") || `Household #${r.orgMembership?.householdId}`;
  };

  const statusCounts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <Stack>
      <Text c="dimmed">
        In-flight applications. Use the manual controls below to confirm the contract was signed
        or that background-check consent was received. (The contract is also confirmed
        automatically once the Zoho webhook is configured.)
      </Text>

      {!loading && rows.length > 0 && (
        <>
          {rows.some((r) => r.status === "BLOCKED") && (
            <Alert color="red" variant="light" fw={600}>
              🚨 {rows.filter((r) => r.status === "BLOCKED").length} application(s) blocked at
              background review — board attention needed.
            </Alert>
          )}
          <Group gap="xs">
            {Object.entries(statusCounts).map(([status, count]) => (
              <Badge key={status} color={statusColor(status)} variant="light">
                {statusLabel(status)}: {count}
              </Badge>
            ))}
          </Group>
        </>
      )}

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : rows.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">No in-flight membership applications.</Text>
        </Card>
      ) : (
        <Stack>
          {rows.map((r) => (
            <Card key={r.id} withBorder radius="md" padding="lg">
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={700} fz="lg">{householdLabel(r)}</Text>
                  <Text size="xs" c="dimmed">
                    {r.kind} · application #{r.id}
                    {r.orgMembership?.isVolunteer && <Text component="span" c="green"> · volunteer</Text>}
                  </Text>
                </div>
                <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
              </Group>

              {r.status === "PENDING_EXTERNAL_ACTION" && (
                <Group gap="xl" wrap="wrap" mt="md">
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Contract</Text>
                    {r.contractSignedAt ? (
                      <Text c="green" fw={600}>✓ Signed</Text>
                    ) : (
                      <Button size="xs" fz={15} disabled={busyId === r.id} onClick={() => act(r.id, "mark-contract")}>
                        Confirm contract signed
                      </Button>
                    )}
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Background-check consent</Text>
                    {r.bgConsentAt ? (
                      <Text c="green" fw={600}>✓ Received</Text>
                    ) : (
                      <Button size="xs" fz={15} variant="default" disabled={busyId === r.id} onClick={() => act(r.id, "mark-bg-consent")}>
                        Confirm BG consent
                      </Button>
                    )}
                  </div>
                </Group>
              )}

              {awaitingBg(r) && (
                <Text size="sm" c="dimmed" mt="md">
                  Background check (in parallel) — <Text component="span" fw={600}>{r.attestations.filter((a) => a.result === "APPROVE").length}/2</Text> approvals recorded.
                </Text>
              )}

              {r.status === "PENDING_PAYMENT" && (
                <Group mt="md" gap="md" wrap="wrap" align="center">
                  <Text size="sm" c="dimmed">Awaiting payment.</Text>
                  <Button size="xs" fz={15} color="green" disabled={busyId === r.id} onClick={() => certify(r.id)}>
                    Certify payment plan → {r.bgClearedAt ? "activate" : "(holds for background check)"}
                  </Button>
                </Group>
              )}

              {r.status === "PENDING_BG_CLEARANCE" && (
                <Text size="sm" c="dimmed" mt="md">
                  Paid — membership activates automatically once the background check clears.
                </Text>
              )}

              {r.status === "BLOCKED" && (
                <Alert color="red" variant="light" mt="md" title="🚨 Blocked at background review — needs board attention.">
                  {r.paidAt && (
                    <Text size="sm" c="red" fw={700} mb="sm">
                      💸 This household already paid — a refund is likely needed (membership was not activated).
                    </Text>
                  )}
                  <Group gap="sm" wrap="wrap">
                    <Button size="xs" fz={15} variant="default" disabled={busyId === r.id} onClick={() => override(r.id, "reset")}>
                      Reset for re-review
                    </Button>
                    <Button size="xs" fz={15} color="green" disabled={busyId === r.id} onClick={() => override(r.id, "approve")}>
                      Override → {r.paidAt ? "activate" : "payment"}
                    </Button>
                  </Group>
                </Alert>
              )}

              {messageId === r.id && (
                <AlertBanner message={message} tone="error" mt="md" />
              )}
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
