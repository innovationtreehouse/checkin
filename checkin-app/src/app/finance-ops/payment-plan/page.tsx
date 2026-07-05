"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { useRequireRole } from '@/hooks/useRequireRole';
import { formatDateTime } from '@/lib/time';
import { notifyNavRefresh } from '@/lib/nav-refresh';
import { formatCents } from '@inventory/money';

import { PageLoader } from "@/components/ui/PageLoader";
type PaymentPlanRequest = {
  programId: number;
  personId: number;
  pendingSince: string;
  person: {
    id: number;
    name: string | null;
    email: string;
  };
  program: {
    id: number;
    name: string;
    orgMemberPriceCents: number | null;
    nonOrgMemberPriceCents: number | null;
  };
};

export default function PendingParticipantsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);

  const [requests, setRequests] = useState<PaymentPlanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [confirmApproveOpened, { open: openConfirmApprove, close: closeConfirmApprove }] = useDisclosure(false);
  const [pendingApproval, setPendingApproval] = useState<{ programId: number; participantId: number } | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/finance-ops/payment-plans');
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      } else {
        setMessage("Failed to load requests. You may not have access.");
      }
    } catch {
      notifications.show({ color: "red", message: "Network error loading requests.", autoClose: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchRequests();
  }, [ready, fetchRequests]);

  const handleApprove = (programId: number, participantId: number) => {
    setPendingApproval({ programId, participantId });
    openConfirmApprove();
  };

  const doApprove = async (programId: number, participantId: number) => {
    try {
      const res = await fetch('/api/finance-ops/payment-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId, participantId })
      });

      if (res.ok) {
        setRequests(prev => prev.filter(r => !(r.programId === programId && r.personId === participantId)));
        notifyNavRefresh();
        notifications.show({ color: 'green', message: 'Payment plan approved.' });
      } else {
        const data = await res.json();
        if (data.error === "No pending payment-plan request") {
          notifications.show({ color: 'red', message: data.error, autoClose: 4000 });
          fetchRequests();
        } else {
          notifications.show({ color: 'red', message: data.error || "Failed to approve.", autoClose: false });
        }
      }
    } catch {
      notifications.show({ color: 'red', message: "Network error processing approval.", autoClose: false });
    }
  };

  const confirmApprove = async () => {
    if (!pendingApproval) return;
    closeConfirmApprove();
    const { programId, participantId } = pendingApproval;
    setPendingApproval(null);
    await doApprove(programId, participantId);
  };

  if (authLoading || loading) {
    return <PageLoader />;
  }

  if (!ready) return null;

  const columns: DataTableColumn<PaymentPlanRequest>[] = [
    {
      header: 'Participant',
      sortBy: (req) => req.person.name?.toLowerCase() ?? req.person.email.toLowerCase(),
      render: (req) => (
        <>
          <Text fw={500}>{req.person.name}</Text>
          <Text size="sm" c="dimmed">{req.person.email}</Text>
        </>
      ),
    },
    {
      header: 'Program',
      sortBy: (req) => req.program.name.toLowerCase(),
      render: (req) => (
        <>
          <Text fw={500}>{req.program.name}</Text>
          <Text size="sm" c="dimmed">
            Price: M {formatCents(req.program.orgMemberPriceCents)} / NM {formatCents(req.program.nonOrgMemberPriceCents)}
          </Text>
        </>
      ),
    },
    {
      header: 'Requested On',
      sortBy: (req) => req.pendingSince, // ISO string sorts chronologically
      render: (req) => <Text size="sm" c="dimmed">{formatDateTime(req.pendingSince)}</Text>,
    },
    {
      header: 'Actions',
      align: 'right',
      render: (req) => (
        <Button size="xs" fz={15} color="green" variant="light" onClick={() => handleApprove(req.programId, req.personId)}>
          Approve &amp; Mark Active
        </Button>
      ),
    },
  ];

  return (
    <Stack>
      <Text c="dimmed">
        Review pending participants who have clicked the &quot;Request Payment Plan&quot; button.
        Approving a request marks the user as ACTIVE and exempts them from the 7-day automated
        removal cron job.
      </Text>

      <AlertBanner message={message} tone="error" />

      <DataTable
        columns={columns}
        rows={requests}
        getRowKey={(req) => `${req.programId}-${req.personId}`}
        emptyMessage="No pending payment plan requests."
      />

      <Modal
        opened={confirmApproveOpened}
        onClose={closeConfirmApprove}
        title={<Text span fw={700} fz="lg">Approve Payment Plan</Text>}
        centered
      >
        <Text mb="lg">
          Approve this payment plan? This sets the participant&apos;s status to ACTIVE and stops
          automated unpaid warning emails.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeConfirmApprove}>Cancel</Button>
          <Button color="green" onClick={confirmApprove}>Approve &amp; Mark Active</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
