"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button, Center, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '@/lib/time';

type Visit = {
  id: number;
  arrived: string | null;
  departed?: string | null;
  participant?: { name?: string | null; email?: string | null } | null;
  event?: { name?: string | null } | null;
};

export default function AdminVisitsPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin']);

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
    if (ready) fetchVisits();
  }, [ready, fetchVisits]);

  const handleEditClick = (visit: Visit) => {
    const confirmEdit = window.confirm("Warning: You are editing a past visit record using Admin overrides. This will be permanently logged.");
    if (!confirmEdit) return;

    setEditingVisitId(visit.id);
    setEditForm({
      arrived: toDatetimeLocal(visit.arrived),
      departed: toDatetimeLocal(visit.departed ?? null)
    });
  };

  const handleSaveEdit = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/visits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: id,
          arrived: editForm.arrived ? fromDatetimeLocal(editForm.arrived) : undefined,
          departed: editForm.departed ? fromDatetimeLocal(editForm.departed) : undefined
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

  if (authLoading || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  return (
    <Stack>
      <AdminPageHeader title="Visit History" back={{ href: '/admin', label: '← Admin Ops' }} />

      <AlertBanner message={message} tone={message.includes('success') ? 'success' : 'error'} />

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
