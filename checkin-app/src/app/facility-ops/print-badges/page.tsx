"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { pdf } from "@react-pdf/renderer";
import { Badge, Button, Checkbox, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import BadgeDocument from "@/components/admin/BadgeDocument";
import StickerDocument from "@/components/admin/StickerDocument";

type ParticipantRow = {
  id: number;
  name: string | null;
  email: string | null;
  isMember?: boolean;
  boardMember?: boolean;
  keyholder?: boolean;
};

export default function PrintBadgesPage() {
  const { status } = useSession();
  const router = useRouter();

  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  const fetchParticipants = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL('/api/participants/search', window.location.origin);
      if (searchTerm) url.searchParams.set('q', searchTerm);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.participants) {
        setParticipants(data.participants);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchParticipants();
    }
  }, [status, fetchParticipants]);

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleAll = () => {
    if (selectedIds.size === participants.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(participants.map(p => p.id)));
    }
  };

  const generate = async (kind: 'badge' | 'sticker') => {
    if (selectedIds.size === 0) return;
    setIsGenerating(true);

    try {
      const selectedParticipants = participants.filter(p => selectedIds.has(p.id));

      // Add QR code data URIs
      const badgesWithQr = await Promise.all(
        selectedParticipants.map(async (p) => {
          const qrDataUri = await QRCode.toDataURL(p.id.toString(), {
            width: 200,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' }
          });
          return {
            id: p.id,
            name: p.name ?? '',
            isMember: !!p.isMember,
            boardMember: !!p.boardMember,
            keyholder: !!p.keyholder,
            qrDataUri,
          };
        })
      );

      const doc = kind === 'badge'
        ? <BadgeDocument badges={badgesWithQr} />
        : <StickerDocument badges={badgesWithQr} />;
      const blob = await pdf(doc).toBlob();

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind === 'badge' ? 'badges' : 'stickers'}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(`Failed to generate ${kind} PDF`, e);
      notifications.show({ color: 'red', message: `Failed to generate ${kind} PDF. Please try again.` });
    } finally {
      setIsGenerating(false);
    }
  };

  if (status === "loading") return null;

  const columns: DataTableColumn<ParticipantRow>[] = [
    {
      header: (
        <Checkbox
          radius={2}
          checked={participants.length > 0 && selectedIds.size === participants.length}
          onChange={toggleAll}
          aria-label="Select all"
        />
      ),
      render: (p) => (
        <Checkbox
          radius={2}
          checked={selectedIds.has(p.id)}
          onChange={() => toggleSelection(p.id)}
          aria-label={`Select ${p.name ?? p.id}`}
        />
      ),
    },
    { header: 'ID', render: (p) => <Text span c="dimmed">#{p.id}</Text> },
    {
      header: 'Name',
      render: (p) => <Text fw={600}>{p.name || 'N/A'}</Text>,
    },
    {
      header: 'Membership',
      render: (p) => (p.isMember ? <Text c="green">Active</Text> : <Text c="red">Inactive</Text>),
    },
    {
      header: 'Roles',
      render: (p) => (
        <Group gap={4}>
          {p.boardMember && <Badge size="xs" color="blue">BOARD</Badge>}
          {p.keyholder && <Badge size="xs" color="orange">KEYHOLDER</Badge>}
          {!p.boardMember && !p.keyholder && p.isMember && (
            <Badge size="xs" color="green">MEMBER</Badge>
          )}
        </Group>
      ),
    },
  ];

  return (
    <Stack>
      <Text c="dimmed">
        Select participants to generate double-sided standard Avery 5390 ID badges.
      </Text>

      <Group gap="md" wrap="wrap">
        <TextInput
          placeholder="Search by name or email..."
          style={{ flex: 1, minWidth: 200 }}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
        />
        <Button onClick={() => generate('badge')} disabled={selectedIds.size === 0 || isGenerating} loading={isGenerating}>
          Generate Badge ({selectedIds.size})
        </Button>
        <Button color="grape" onClick={() => generate('sticker')} disabled={selectedIds.size === 0 || isGenerating} loading={isGenerating}>
          Generate Sticker ({selectedIds.size})
        </Button>
      </Group>

      <DataTable
        columns={columns}
        rows={participants}
        getRowKey={(p) => p.id}
        loading={loading}
        emptyMessage="No participants found."
        rowProps={(p) => ({ bg: selectedIds.has(p.id) ? 'var(--mantine-color-blue-light)' : undefined })}
      />
    </Stack>
  );
}
