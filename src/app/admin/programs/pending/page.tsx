"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, Center, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { formatDateTime } from '@/lib/time';

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
    memberPrice: number | null;
    nonMemberPrice: number | null;
  };
};

export default function PaymentPlansPage() {
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
        router.push('/admin');
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
    return (
      <Center mih="60vh"><Title order={2}>Forbidden</Title></Center>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>Payment Plan Requests</Title>
        <Button variant="default" onClick={() => router.push('/admin')}>← Back to Admin</Button>
      </Group>

      <Text c="dimmed">
        Review pending participants who have clicked the &quot;Request Payment Plan&quot; button.
        Approving a request marks the user as ACTIVE and exempts them from the 7-day automated
        removal cron job.
      </Text>

      <AlertBanner message={message} tone="error" />

      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Participant</Table.Th>
              <Table.Th>Program</Table.Th>
              <Table.Th>Requested On</Table.Th>
              <Table.Th ta="right">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {requests.map((req) => (
              <Table.Tr key={`${req.programId}-${req.participantId}`}>
                <Table.Td>
                  <Text fw={500}>{req.participant.name}</Text>
                  <Text size="sm" c="dimmed">{req.participant.email}</Text>
                </Table.Td>
                <Table.Td>
                  <Text fw={500}>{req.program.name}</Text>
                  <Text size="sm" c="dimmed">
                    Price: M ${req.program.memberPrice || 0} / NM ${req.program.nonMemberPrice || 0}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">{formatDateTime(req.pendingSince)}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Button size="xs" color="green" variant="light" onClick={() => handleApprove(req.programId, req.participantId)}>
                    Approve &amp; Mark Active
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {requests.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4} ta="center">
                  <Text c="dimmed" py="md">No pending payment plan requests.</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
