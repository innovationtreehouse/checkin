"use client";

import { useState, useEffect, useCallback } from 'react';
import { Badge, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { useRequireRole } from '@/hooks/useRequireRole';
import { formatDateTime, relTime } from '@/lib/time';
import { notifyNavRefresh } from '@/lib/nav-refresh';
import { formatCents } from '@inventory/money';
import { PageLoader } from "@/components/ui/PageLoader";

// Mirrors the flat shape returned by GET /api/finance-ops/payments.
type PaymentException = {
  id: number;
  kind: string;
  severity: 'WARN' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  shopifyOrderId: string | null;
  processId: number | null;
  programId: number | null;
  personId: number | null;
  detectedAt: string;
  familyName: string | null;
  familyEmail: string | null;
  programName: string | null;
  live: {
    financialStatus: string | null;
    totalCents: number;
    totalRefundedCents: number;
    cancelledAt: string | null;
  } | null;
};

// Mirrors GET /api/finance-ops/s-read/sync. `status` is s-read's enum, read verbatim
// — treat anything outside the known set as "no longer running" (see isTerminal).
type SyncRun = {
  status: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

// Polling budget after a manual sync: 20 × 6s ≈ 2 minutes. Bounded on purpose —
// every poll queries the mirror and keeps the scale-to-zero Aurora cluster awake,
// which is the cost that makes the automatic sync daily rather than continuous
// (infra#129). A sync still running at the cap is not lost, just no longer watched;
// the status line picks it up on the next page load.
const POLL_INTERVAL_MS = 6_000;
const POLL_MAX_ATTEMPTS = 20;

// RUNNING is the only non-terminal state. COMPLETED / FAILED / ABANDONED all mean
// "stop watching" — ABANDONED being s-read's reaper relabelling a run whose process
// was killed, which is exactly why polling must not treat "not COMPLETED" as "keep
// waiting". An unrecognised status also stops: s-read owns this enum, and a value we
// do not know is not grounds to poll forever.
const isTerminal = (status: string) => status !== 'RUNNING';

/** "12 min ago · completed", or "· running" while in flight. */
function describeSync(run: SyncRun): string {
  const when = isTerminal(run.status) && run.finishedAt ? run.finishedAt : run.startedAt;
  return `${relTime(when)} · ${run.status.toLowerCase()}`;
}

export default function PaymentProblemsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);

  const [rows, setRows] = useState<PaymentException[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [resolveOpened, { open: openResolve, close: closeResolve }] = useDisclosure(false);
  const [pendingResolve, setPendingResolve] = useState<PaymentException | null>(null);
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  // null = no run yet or the mirror isn't wired in this env (the GET 503s) — either
  // way there is nothing to say, so the status line just doesn't render.
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);

  const fetchSyncRun = useCallback(async (): Promise<SyncRun | null> => {
    try {
      const res = await fetch('/api/finance-ops/s-read/sync');
      if (!res.ok) return null;
      const run: SyncRun | null = (await res.json()).run;
      setSyncRun(run);
      return run;
    } catch {
      // Freshness is decoration on this page; a failed status read must never
      // surface as an error over the queue itself.
      return null;
    }
  }, []);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch('/api/finance-ops/payments');
      if (res.ok) {
        setRows(await res.json());
      } else {
        setMessage("Failed to load payment problems. You may not have access.");
      }
    } catch {
      notifications.show({ color: "red", message: "Network error loading payment problems.", autoClose: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      fetchRows();
      fetchSyncRun();
    }
  }, [ready, fetchRows, fetchSyncRun]);

  const patch = async (id: number, action: 'acknowledge' | 'resolve', noteText?: string) => {
    try {
      const res = await fetch(`/api/finance-ops/payments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: noteText }),
      });
      if (res.ok) {
        await fetchRows();
        notifyNavRefresh();
        notifications.show({ color: 'green', message: action === 'resolve' ? 'Payment problem resolved.' : 'Payment problem acknowledged.' });
      } else {
        const data = await res.json();
        notifications.show({ color: 'red', message: data.error || "Failed to update.", autoClose: false });
        if (res.status === 409) fetchRows();
      }
    } catch {
      notifications.show({ color: 'red', message: "Network error updating the payment problem.", autoClose: false });
    }
  };

  // Force an s-read incremental sync. The mirror behind "Live payment" refreshes once
  // a day, so a problem fixed in Shopify this morning still reads stale here until
  // tomorrow. The POST only STARTS the sync, so we then poll the run's status and
  // refetch the table once it lands — "Live payment" reads straight from the mirror,
  // so those amounts can differ the moment the sync finishes.
  //
  // Note the queue ROWS themselves are the reconciler's output, not the sync's, and
  // the reconciler runs on its own daily tick — so a finished sync refreshes the live
  // amounts, but a problem it resolves stays listed until the next reconcile.
  const triggerSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/finance-ops/s-read/sync', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        notifications.show({ color: 'red', message: data.error || "Failed to start the Shopify sync.", autoClose: false });
        return;
      }
      notifications.show({ color: 'green', message: 'Shopify sync started…' });

      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const run = await fetchSyncRun();
        // A null run means the status read failed or the mirror isn't wired — there is
        // nothing to watch, so stop rather than burn the whole budget on empty polls.
        if (!run) break;
        if (!isTerminal(run.status)) continue;

        await fetchRows();
        if (run.status === 'COMPLETED') {
          notifications.show({ color: 'green', message: 'Shopify sync finished. Live payment amounts are up to date.' });
        } else {
          notifications.show({
            color: 'red',
            message: `Shopify sync ${run.status.toLowerCase()}. Live payment amounts may still be stale.`,
            autoClose: false,
          });
        }
        return;
      }
      // Ran out of budget with the sync still going — it is still running server-side.
      notifications.show({
        color: 'yellow',
        message: 'Shopify sync is still running. Reload the page in a few minutes to see the result.',
      });
    } catch {
      notifications.show({ color: 'red', message: "Network error starting the Shopify sync.", autoClose: false });
    } finally {
      setSyncing(false);
    }
  };

  const handleResolve = (row: PaymentException) => {
    setPendingResolve(row);
    setNote("");
    openResolve();
  };

  const confirmResolve = async () => {
    if (!pendingResolve) return;
    closeResolve();
    const { id } = pendingResolve;
    setPendingResolve(null);
    await patch(id, 'resolve', note);
  };

  if (authLoading || loading) {
    return <PageLoader />;
  }

  if (!ready) return null;

  const columns: DataTableColumn<PaymentException>[] = [
    {
      header: 'Severity',
      sortBy: (row) => row.severity,
      render: (row) => (
        <Badge color={row.severity === 'CRITICAL' ? 'red' : 'yellow'} variant="light">
          {row.severity}
        </Badge>
      ),
    },
    {
      header: 'Problem',
      sortBy: (row) => row.kind,
      render: (row) => (
        <>
          <Text fw={500}>{row.kind.replace(/_/g, ' ')}</Text>
          {row.programName && <Text size="sm" c="dimmed">{row.programName}</Text>}
        </>
      ),
    },
    {
      header: 'Family',
      sortBy: (row) => row.familyName?.toLowerCase() ?? row.familyEmail?.toLowerCase() ?? '',
      render: (row) => (
        <>
          <Text fw={500}>{row.familyName ?? '—'}</Text>
          {row.familyEmail && <Text size="sm" c="dimmed">{row.familyEmail}</Text>}
        </>
      ),
    },
    {
      header: 'Live payment',
      render: (row) =>
        row.live ? (
          <>
            <Text size="sm">{row.live.financialStatus ?? 'unknown'}</Text>
            <Text size="sm" c="dimmed">
              {formatCents(row.live.totalCents)}
              {row.live.totalRefundedCents > 0 && ` (−${formatCents(row.live.totalRefundedCents)} refunded)`}
              {row.live.cancelledAt && ' · cancelled'}
            </Text>
          </>
        ) : (
          <Text size="sm" c="dimmed">{row.shopifyOrderId ? `Order ${row.shopifyOrderId}` : 'No order'}</Text>
        ),
    },
    {
      header: 'Detected',
      sortBy: (row) => row.detectedAt,
      render: (row) => <Text size="sm" c="dimmed">{formatDateTime(row.detectedAt)}</Text>,
    },
    {
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <Group justify="flex-end" gap="xs" wrap="nowrap">
          {row.status === 'OPEN' && (
            <Button size="xs" fz={15} variant="light" onClick={() => patch(row.id, 'acknowledge')}>
              Acknowledge
            </Button>
          )}
          <Button size="xs" fz={15} color="green" variant="light" onClick={() => handleResolve(row)}>
            Resolve
          </Button>
        </Group>
      ),
    },
  ];

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text c="dimmed">
          Reconciler-detected Shopify payment problems awaiting board review. Nothing here is changed
          automatically — acknowledge to mark a problem as seen, or resolve once you&apos;ve handled it
          (e.g. in Shopify or on the membership record).
        </Text>
        <Button
          variant="light"
          onClick={triggerSync}
          loading={syncing}
          style={{ flexShrink: 0 }}
        >
          Sync Shopify now
        </Button>
      </Group>

      <Text size="sm" c="dimmed">
        Shopify data syncs automatically once a day. If you&apos;ve just changed something in Shopify
        and want it reflected here sooner, sync now.
        {syncRun && ` Last Shopify sync: ${describeSync(syncRun)}.`}
      </Text>

      <AlertBanner message={message} tone="error" />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        emptyMessage="No open payment problems."
      />

      <Modal
        opened={resolveOpened}
        onClose={closeResolve}
        title={<Text span fw={700} fz="lg">Resolve Payment Problem</Text>}
        centered
      >
        <Text mb="sm">
          Mark this {pendingResolve?.kind.replace(/_/g, ' ').toLowerCase()} problem as resolved. Add a note
          describing what was done.
        </Text>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="What did you do to resolve this? (optional)"
          autosize
          minRows={3}
          mb="lg"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={closeResolve}>Cancel</Button>
          <Button color="green" onClick={confirmResolve}>Resolve</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
