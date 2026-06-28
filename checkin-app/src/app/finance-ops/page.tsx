"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, Center, Container, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { formatDateTime } from '@/lib/time';
import { notifyNavRefresh } from '@/lib/nav-refresh';
import { formatCents } from '@inventory/money';

type PaymentPlanRequest = {
  programId: number;
  participantId: number;
  pendingSince: string;
  participant: {
    id: number;
    name: string | null;
    email: string;
  };
  program: {
    id: number;
    name: string;
    memberPriceCents: number | null;
    nonMemberPriceCents: number | null;
  };
};

export default function FinanceOpsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [requests, setRequests] = useState<PaymentPlanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/programs/payment-plans');
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      } else {
        setMessage("Failed to load requests. You may not have access.");
      }
    } catch {
      setMessage("Network error loading requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      const user = session.user;
      if (!user?.sysadmin && !user?.boardMember) {
        router.push('/');
      }
      fetchRequests();
    }
  }, [status, router, session, fetchRequests]);

  const handleApprove = async (programId: number, participantId: number) => {
    if (!confirm("Approve this payment plan? This sets the participant's status to ACTIVE and stops automated unpaid warning emails.")) return;

    try {
      const res = await fetch('/api/programs/payment-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId, participantId })
      });

      if (res.ok) {
        setRequests(prev => prev.filter(r => !(r.programId === programId && r.participantId === participantId)));
        notifyNavRefresh();
      } else {
        const data = await res.json();
        notifications.show({ color: 'red', message: data.error || "Failed to approve." });
      }
    } catch {
      notifications.show({ color: 'red', message: "Network error processing approval." });
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null;

  const user = session.user;
  if (!user.boardMember && !user.sysadmin) {
    return <Center mih="60vh"><Title order={2}>Forbidden</Title></Center>;
  }

  const columns: DataTableColumn<PaymentPlanRequest>[] = [
    {
      header: 'Participant',
      sortBy: (req) => req.participant.name?.toLowerCase() ?? req.participant.email.toLowerCase(),
      render: (req) => (
        <>
          <Text fw={500}>{req.participant.name}</Text>
          <Text size="sm" c="dimmed">{req.participant.email}</Text>
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
            Price: M {formatCents(req.program.memberPriceCents)} / NM {formatCents(req.program.nonMemberPriceCents)}
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
        <Button size="xs" color="green" variant="light" onClick={() => handleApprove(req.programId, req.participantId)}>
          Approve &amp; Mark Active
        </Button>
      ),
    },
  ];

  return (
    <Container size="lg" py="md">
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap">
        <div>
          <Title order={1}>Finance Operations</Title>
          <Text c="dimmed">Payments and billing review.</Text>
        </div>
      </Group>

      <Tabs defaultValue="pending">
        <Tabs.List>
          <Tabs.Tab value="pending">⏳ Pending Participants</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="pending" pt="lg">
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
              getRowKey={(req) => `${req.programId}-${req.participantId}`}
              emptyMessage="No pending payment plan requests."
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
