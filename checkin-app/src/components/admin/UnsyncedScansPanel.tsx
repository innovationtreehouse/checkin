"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Center, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { relTime } from "@/lib/time";
import { useOrgTime } from "@/components/TimezoneProvider";

type UnsyncedScan = {
  id: number;
  timestamp: string;
  location: string | null;
  reviewReason: string | null;
  // Never null: RawBadgeLog.personId is required, and id/name are public-tier
  // so the response stripper cannot drop them out from under the fallback.
  person: { id: number; name: string | null };
};

// D7's "40 min late" off lib/time's coarse relTime — the same thresholds every
// other freshness line uses, in the tense the review copy asks for. "just now"
// has no " ago" to swap and reads correctly as-is.
const lateness = (when: string) => relTime(when).replace(/ ago$/, " late");

const REASON_COPY: Record<string, string> = {
  stale_replay: "queued scan arrived after the freshness window",
  out_of_order: "state had already moved past this scan",
  force_close_review: "force-close replay without a valid confirm token",
  facility_closed: "badge scanned while no keyholder was present",
};

// client_dead:<status> is a dynamic family, not a fixed key.
const reasonCopy = (reason: string) => {
  const dead = reason.match(/^client_dead:(\d+)$/);
  if (dead) return `kiosk client failed (HTTP ${dead[1]})`;
  return REASON_COPY[reason] ?? reason;
};

export function UnsyncedScansPanel() {
  const [scans, setScans] = useState<UnsyncedScan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<number>>(new Set());
  const { formatTime } = useOrgTime();

  useEffect(() => {
    fetch("/api/system-status/unsynced-scans")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setScans(data.scans ?? []))
      .catch(() => setFailed(true));
  }, []);

  async function dismiss(id: number) {
    setDismissing((prev) => new Set(prev).add(id));
    setActionError(null);
    try {
      const res = await fetch(`/api/system-status/unsynced-scans/${id}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScans((rows) => (rows ?? []).filter((r) => r.id !== id));
    } catch {
      setActionError("Could not dismiss that scan. Reload and try again.");
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (failed) return <Text c="red">Failed to load unsynced scans.</Text>;
  if (!scans) {
    return (
      <Center mih="30vh">
        <Loader />
      </Center>
    );
  }

  if (scans.length === 0) {
    return (
      <Card withBorder radius="md" padding="lg">
        <Text c="green">● No scans awaiting review.</Text>
        <Text size="sm" c="dimmed" mt="xs">
          A kiosk scan that replayed too late, or out of order, is recorded but not applied to
          anyone&apos;s attendance. Those land here for a human to record or dismiss.
        </Text>
      </Card>
    );
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Title order={4} mb="md">Scans Awaiting Review</Title>
      <Text c="dimmed" size="sm" mb="md">
        These kiosk scans were recorded but never applied to attendance — the queued scan reached
        the server too late, or after the person&apos;s record had already moved on. Record the
        visit by hand, or dismiss the row once you have looked. Up to 100 shown, newest first.
      </Text>
      {actionError && <Text c="red" size="sm" mb="sm">{actionError}</Text>}
      <Table.ScrollContainer minWidth={600}>
        <Table striped verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Scan</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {scans.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>
                  <Stack gap={2}>
                    {/* D7 row copy: "Person X, scanned 2:14pm, 40 min late". */}
                    <Text>
                      {s.person.name ?? `Person #${s.person.id}`}, scanned{" "}
                      {formatTime(s.timestamp, { hour: "numeric", minute: "2-digit" })},{" "}
                      {lateness(s.timestamp)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {s.reviewReason
                        ? reasonCopy(s.reviewReason)
                        : "parked"}
                      {s.location ? ` · ${s.location}` : ""}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap", width: 1 }}>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    {/* Deep link only — this panel mints nothing. Writing a Visit at
                        scannedAt inherits the open KIOSK_RESILIENCE §5.26/B4 staleness
                        question, so the record goes through the manual-visit tool that
                        already owns those bounds. */}
                    <Button component={Link} href="/facility-ops/visits" size="xs" variant="default">
                      Record visit
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      loading={dismissing.has(s.id)}
                      onClick={() => dismiss(s.id)}
                    >
                      Dismiss
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
