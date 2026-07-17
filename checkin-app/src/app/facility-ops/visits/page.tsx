"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert, Button, Group, Modal, Stack, Table, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconChevronUp, IconDeviceLaptop, IconRobot, IconScan, IconSelector } from '@tabler/icons-react';
import { useRequireRole } from '@/hooks/useRequireRole';
import { AlertBanner, type AlertTone } from '@/components/admin/AlertBanner';
import { notifications } from '@mantine/notifications';
import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '@/lib/time';

import { PageLoader } from "@/components/ui/PageLoader";
type VisitSource = 'SCANNER' | 'WEB' | 'SYSTEM';

type Visit = {
  id: number;
  arrivedAt: string | null;
  departedAt?: string | null;
  arrivedVia?: VisitSource | null;
  departedVia?: VisitSource | null;
  person?: { name?: string | null; email?: string | null } | null;
  event?: { name?: string | null } | null;
};

const SOURCE_META: Record<VisitSource, { Icon: typeof IconScan; label: string }> = {
  SCANNER: { Icon: IconScan, label: 'Scanner (kiosk badge)' },
  WEB: { Icon: IconDeviceLaptop, label: 'Web (dashboard)' },
  SYSTEM: { Icon: IconRobot, label: 'Automated (facility close / nightly)' },
};

const SourceIcon = ({ via }: { via?: VisitSource | null }) => {
  if (!via) return null;
  const { Icon, label } = SOURCE_META[via];
  return (
    <Tooltip label={label} withArrow>
      <Icon size={14} stroke={1.5} style={{ verticalAlign: 'middle', color: 'var(--mantine-color-dimmed)' }} />
    </Tooltip>
  );
};

type RowNoticeState = { id: number; text: string; tone: AlertTone } | null;

const RowNotice = ({ notice, id, onClose }: { notice: RowNoticeState; id: number; onClose: () => void }) => {
  if (notice?.id !== id) return null;
  return (
    <Alert py={4} px="xs" color={notice.tone === 'success' ? 'green' : 'red'} variant="light" withCloseButton onClose={onClose}>
      {notice.text}
    </Alert>
  );
};

type SortKey = 'id' | 'participant' | 'event' | 'arrivedAt' | 'departedAt';

const sortValue = (v: Visit, key: SortKey): string | number => {
  switch (key) {
    case 'id': return v.id;
    case 'participant': return (v.person?.name || v.person?.email || '').toLowerCase();
    case 'event': return (v.event?.name || 'Open Facility').toLowerCase();
    case 'arrivedAt': return v.arrivedAt ? Date.parse(v.arrivedAt) : 0;
    case 'departedAt': return v.departedAt ? Date.parse(v.departedAt) : 0;
  }
};

export default function AdminVisitsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin']);

  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: AlertTone } | null>(null);

  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arrivedAt: "", departedAt: "" });
  // Save error shown inline in the edited row's Actions cell — the row stays in
  // edit mode on failure, and the page-top banner lands off-screen on long tables
  // and reads as "nothing happened". Success uses the standard corner toast.
  const [rowNotice, setRowNotice] = useState<{ id: number; text: string; tone: AlertTone } | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'arrivedAt', dir: 'desc' });
  const [confirmEditOpened, { open: openConfirmEdit, close: closeConfirmEdit }] = useDisclosure(false);
  const [pendingEditVisit, setPendingEditVisit] = useState<Visit | null>(null);

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
      const res = await fetch('/api/facility/visits');
      if (res.ok) {
        const data = await res.json();
        setVisits(data.visits);
      } else {
        setMessage({ text: "Failed to load visits.", tone: "error" });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error loading visits.", autoClose: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchVisits();
  }, [ready, fetchVisits]);

  const handleEditClick = (visit: Visit) => {
    setPendingEditVisit(visit);
    openConfirmEdit();
  };

  const confirmEditClick = () => {
    if (!pendingEditVisit) return;
    closeConfirmEdit();
    setRowNotice(null);
    setEditingVisitId(pendingEditVisit.id);
    setEditForm({
      arrivedAt: toDatetimeLocal(pendingEditVisit.arrivedAt),
      departedAt: toDatetimeLocal(pendingEditVisit.departedAt ?? null)
    });
    setPendingEditVisit(null);
  };

  const handleSaveEdit = async (id: number) => {
    // Instant feedback only — server remains the trust boundary.
    if (!editForm.departedAt) {
      setRowNotice({ id, text: "Departure time is required to close this visit.", tone: "error" });
      return;
    }
    if (editForm.arrivedAt && Date.parse(editForm.departedAt) <= Date.parse(editForm.arrivedAt)) {
      setRowNotice({ id, text: "Departure time must be after arrival time", tone: "error" });
      return;
    }
    if (editForm.arrivedAt && Date.parse(editForm.departedAt) - Date.parse(editForm.arrivedAt) > 24 * 60 * 60 * 1000) {
      setRowNotice({ id, text: "A visit cannot be longer than 24 hours.", tone: "error" });
      return;
    }
    try {
      const res = await fetch(`/api/facility/visits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: id,
          arrivedAt: editForm.arrivedAt ? fromDatetimeLocal(editForm.arrivedAt) : undefined,
          departedAt: editForm.departedAt ? fromDatetimeLocal(editForm.departedAt) : undefined
        })
      });
      if (res.ok) {
        notifications.show({ color: "green", message: "Visit updated successfully." });
        setEditingVisitId(null);
        fetchVisits();
      } else {
        const data = await res.json().catch(() => ({}));
        setRowNotice({ id, text: data.error || "Failed to update visit.", tone: "error" });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error saving visit.", autoClose: false });
    }
  };

  if (authLoading || loading) {
    return <PageLoader />;
  }

  if (!ready) return null;

  return (
    <Stack>
      <AlertBanner message={message?.text} tone={message?.tone} />

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <SortableTh k="id" label="ID" />
              <SortableTh k="participant" label="Participant" />
              <SortableTh k="event" label="Event" />
              <SortableTh k="arrivedAt" label="Arrived" />
              <SortableTh k="departedAt" label="Departed" />
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedVisits.map((v) => (
              <Table.Tr key={v.id}>
                <Table.Td>{v.id}</Table.Td>
                <Table.Td>{v.person?.name || v.person?.email}</Table.Td>
                <Table.Td>{v.event?.name || 'Open Facility'}</Table.Td>

                {editingVisitId === v.id ? (
                  <>
                    <Table.Td>
                      <TextInput
                        type="datetime-local"
                        size="xs"
                        value={editForm.arrivedAt}
                        onChange={(e) => setEditForm({ ...editForm, arrivedAt: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        type="datetime-local"
                        size="xs"
                        value={editForm.departedAt}
                        onChange={(e) => setEditForm({ ...editForm, departedAt: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={6}>
                        <Group gap="xs" wrap="nowrap">
                          <Button size="xs" fz={15} color="green" onClick={() => handleSaveEdit(v.id)}>Save</Button>
                          <Button size="xs" fz={15} variant="default" onClick={() => setEditingVisitId(null)}>Cancel</Button>
                        </Group>
                        <RowNotice notice={rowNotice} id={v.id} onClose={() => setRowNotice(null)} />
                      </Stack>
                    </Table.Td>
                  </>
                ) : (
                  <>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <span>{formatDateTime(v.arrivedAt)}</span>
                        <SourceIcon via={v.arrivedVia} />
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {v.departedAt ? (
                        <Group gap={6} wrap="nowrap">
                          <span>{formatDateTime(v.departedAt)}</span>
                          <SourceIcon via={v.departedVia} />
                        </Group>
                      ) : <Text component="span" c="yellow">Active</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Button size="xs" fz={15} variant="light" onClick={() => handleEditClick(v)}>Edit</Button>
                    </Table.Td>
                  </>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal
        opened={confirmEditOpened}
        onClose={closeConfirmEdit}
        title={<Text span fw={700} fz="lg">Edit Past Visit Record</Text>}
        centered
      >
        <Text mb="lg">
          Warning: You are editing a past visit record using Admin overrides. This will be permanently logged.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeConfirmEdit}>Cancel</Button>
          <Button color="red" onClick={confirmEditClick}>Continue</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
