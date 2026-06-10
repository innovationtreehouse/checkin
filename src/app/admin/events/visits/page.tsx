"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Center, Group, Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { formatDateTime } from '@/lib/time';

type Visit = {
  id: number;
  arrived: string | null;
  departed?: string | null;
  participant?: { name?: string | null; email?: string | null } | null;
  event?: { name?: string | null } | null;
};

export default function AdminVisitsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [message, setMessage] = useState("");

  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arrived: "", departed: "" });

  const fetchVisits = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/visits');
      if (res.ok) {
        const data = await res.json();
        setVisits(data.visits);
      } else {
        setMessage("Failed to load visits.");
      }
    } catch {
      setMessage("Network error loading visits.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      if (!session.user?.sysadmin) {
        router.push('/');
      } else {
        fetchVisits();
      }
    }
  }, [status, session, router, fetchVisits]);

  const handleEditClick = (visit: Visit) => {
    const confirmEdit = window.confirm("Warning: You are editing a past visit record using Admin overrides. This will be permanently logged.");
    if (!confirmEdit) return;

    setEditingVisitId(visit.id);
    const formatForInput = (dateString: string | null) => {
      if (!dateString) return "";
      const d = new Date(dateString);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    setEditForm({
      arrived: formatForInput(visit.arrived),
      departed: formatForInput(visit.departed ?? null)
    });
  };

  const handleSaveEdit = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/visits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: id,
          arrived: editForm.arrived ? new Date(editForm.arrived).toISOString() : undefined,
          departed: editForm.departed ? new Date(editForm.departed).toISOString() : undefined
        })
      });
      if (res.ok) {
        setMessage("Visit updated successfully.");
        setEditingVisitId(null);
        fetchVisits();
      } else {
        setMessage("Failed to update visit.");
      }
    } catch {
      setMessage("Network error saving visit.");
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session || !session.user?.sysadmin) return null;

  return (
    <Stack>
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>Visit History</Title>
        <Button variant="default" onClick={() => router.push('/admin')}>← Admin Ops</Button>
      </Group>

      {message && (
        <Alert color={message.includes('success') ? 'green' : 'red'}>{message}</Alert>
      )}

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Participant</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Arrived</Table.Th>
              <Table.Th>Departed</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visits.map((v) => (
              <Table.Tr key={v.id}>
                <Table.Td>{v.id}</Table.Td>
                <Table.Td>{v.participant?.name || v.participant?.email}</Table.Td>
                <Table.Td>{v.event?.name || 'Open Facility'}</Table.Td>

                {editingVisitId === v.id ? (
                  <>
                    <Table.Td>
                      <TextInput
                        type="datetime-local"
                        size="xs"
                        value={editForm.arrived}
                        onChange={(e) => setEditForm({ ...editForm, arrived: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        type="datetime-local"
                        size="xs"
                        value={editForm.departed}
                        onChange={(e) => setEditForm({ ...editForm, departed: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Button size="xs" color="green" onClick={() => handleSaveEdit(v.id)}>Save</Button>
                        <Button size="xs" variant="default" onClick={() => setEditingVisitId(null)}>Cancel</Button>
                      </Group>
                    </Table.Td>
                  </>
                ) : (
                  <>
                    <Table.Td>{formatDateTime(v.arrived)}</Table.Td>
                    <Table.Td>
                      {v.departed ? formatDateTime(v.departed) : <Text component="span" c="yellow">Active</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="light" onClick={() => handleEditClick(v)}>Edit</Button>
                    </Table.Td>
                  </>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
