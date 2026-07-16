"use client";

import { useState, useEffect, useCallback } from 'react';
import { Badge, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { useRequireRole } from '@/hooks/useRequireRole';
import { formatDateTime } from '@/lib/time';
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

export default function PaymentProblemsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);

  const [rows, setRows] = useState<PaymentException[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [resolveOpened, { open: openResolve, close: closeResolve }] = useDisclosure(false);
  const [pendingResolve, setPendingResolve] = useState<PaymentException | null>(null);
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState(false);

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
    if (ready) fetchRows();
  }, [ready, fetchRows]);

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
  // tomorrow. The sync runs in the background (this returns as soon as it is started),
  // and the reconciler picks the fresh data up on its next run — so this does NOT
  // refetch the table: there would be nothing new to see yet.
  const triggerSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/finance-ops/s-read/sync', { method: 'POST' });
      if (res.ok) {
        notifications.show({
          color: 'green',
          message: 'Shopify sync started. Live payment amounts refresh once it finishes — check back in a few minutes.',
        });
      } else {
        const data = await res.json();
        notifications.show({ color: 'red', message: data.error || "Failed to start the Shopify sync.", autoClose: false });
      }
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
