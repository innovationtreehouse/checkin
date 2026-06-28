"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Center, Group, Loader, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AlertBanner } from '@/components/admin/AlertBanner';
import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '@/lib/time';

type Visit = {
  id: number;
  arrived: string | null;
  departed?: string | null;
  participant?: { name?: string | null; email?: string | null } | null;
  event?: { name?: string | null } | null;
};

type SortKey = 'id' | 'participant' | 'event' | 'arrived' | 'departed';

const sortValue = (v: Visit, key: SortKey): string | number => {
  switch (key) {
    case 'id': return v.id;
    case 'participant': return (v.participant?.name || v.participant?.email || '').toLowerCase();
    case 'event': return (v.event?.name || 'Open Facility').toLowerCase();
    case 'arrived': return v.arrived ? Date.parse(v.arrived) : 0;
    case 'departed': return v.departed ? Date.parse(v.departed) : 0;
  }
};

export default function AdminVisitsPage() {
  const { ready, loading: authLoading } = useRequireRole(['sysadmin']);

  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [message, setMessage] = useState("");

  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arrived: "", departed: "" });

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'arrived', dir: 'desc' });

  const sortedVisits = useMemo(() => {
    return [...visits].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [visits, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const SortableTh = ({ k, label }: { k: SortKey; label: string }) => {
    const active = sort.key === k;
    const Icon = !active ? IconSelector : sort.dir === 'asc' ? IconChevronUp : IconChevronDown;
    return (
      <Table.Th>
        <UnstyledButton onClick={() => toggleSort(k)} style={{ font: 'inherit' }}>
          <Group gap={4} wrap="nowrap">
            <span>{label}</span>
            <Icon size={14} stroke={1.5} />
          </Group>
        </UnstyledButton>
      </Table.Th>
    );
  };

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
      <AlertBanner message={message} tone={message.includes('success') ? 'success' : 'error'} />

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <SortableTh k="id" label="ID" />
              <SortableTh k="participant" label="Participant" />
              <SortableTh k="event" label="Event" />
              <SortableTh k="arrived" label="Arrived" />
              <SortableTh k="departed" label="Departed" />
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedVisits.map((v) => (
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
