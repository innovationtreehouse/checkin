"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { pdf } from "@react-pdf/renderer";
import { Badge, Button, Center, Checkbox, Group, Loader, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import BadgeDocument from "@/components/admin/BadgeDocument";
import StickerDocument from "@/components/admin/StickerDocument";

type ParticipantRow = {
  id: number;
  name: string | null;
  email: string | null;
  isMember?: boolean;
  boardMember?: boolean;
  shopSteward?: boolean;
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
      const url = new URL('/api/admin/participants/search', window.location.origin);
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
            shopSteward: !!p.shopSteward,
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

  return (
    <Stack>
      <AdminPageHeader title="Print ID Badges" back={{ href: '/admin', label: '← Back to Admin Hub' }} />

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

      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Checkbox
                  checked={participants.length > 0 && selectedIds.size === participants.length}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Membership</Table.Th>
              <Table.Th>Roles</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading ? (
              <Table.Tr>
                <Table.Td colSpan={5}><Center py="md"><Loader size="sm" /></Center></Table.Td>
              </Table.Tr>
            ) : participants.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5} ta="center"><Text c="dimmed" py="md">No participants found.</Text></Table.Td>
              </Table.Tr>
            ) : participants.map((p) => (
              <Table.Tr key={p.id} bg={selectedIds.has(p.id) ? 'var(--mantine-color-blue-light)' : undefined}>
                <Table.Td>
                  <Checkbox
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelection(p.id)}
                    aria-label={`Select ${p.name ?? p.id}`}
                  />
                </Table.Td>
                <Table.Td c="dimmed">#{p.id}</Table.Td>
                <Table.Td>
                  <Text fw={600}>{p.name || 'N/A'}</Text>
                  <Text size="sm" c="dimmed">{p.email}</Text>
                </Table.Td>
                <Table.Td>
                  {p.isMember ? <Text c="green">Active</Text> : <Text c="red">Inactive</Text>}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {p.boardMember && <Badge size="xs" color="blue">BOARD</Badge>}
                    {p.shopSteward && <Badge size="xs" color="grape">STEWARD</Badge>}
                    {p.keyholder && <Badge size="xs" color="orange">KEYHOLDER</Badge>}
                    {!p.boardMember && !p.shopSteward && !p.keyholder && p.isMember && (
                      <Badge size="xs" color="green">MEMBER</Badge>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
