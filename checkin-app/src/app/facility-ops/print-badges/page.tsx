"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { pdf } from "@react-pdf/renderer";
import { Badge, Button, Checkbox, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import BadgeDocument from "@/components/admin/BadgeDocument";
import StickerDocument from "@/components/admin/StickerDocument";
import { computeDisplayNames } from "@/components/admin/badgeNames";

type ParticipantRow = {
  id: number;
  name: string | null;
  email: string | null;
  isMember?: boolean;
  isBoardMember?: boolean;
  isKeyholder?: boolean;
};

export default function PrintBadgesPage() {
  const { status } = useSession();
  const router = useRouter();

  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  // The active membership, which is what badge names are disambiguated against. `null` until it
  // loads: printing before then would stamp names computed against an empty cohort.
  const [memberCohort, setMemberCohort] = useState<{ id: number; name: string }[] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [hideInactive, setHideInactive] = useState(true);
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
      const url = new URL('/api/people/search', window.location.origin);
      if (searchTerm) url.searchParams.set('q', searchTerm);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.people) {
        setParticipants(data.people);
      }
    } catch (e) {
      console.error("Failed to search people for badges:", e);
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchParticipants();
    }
  }, [status, fetchParticipants]);

  // Cohort is search-independent, so it loads once rather than per keystroke.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shop/org-members');
        if (!res.ok) throw new Error(`org-members responded ${res.status}`);
        const data = await res.json();
        if (!cancelled) setMemberCohort(data.orgMembers ?? []);
      } catch (e) {
        console.error("Failed to load the active member roster:", e);
        notifications.show({
          color: 'red',
          message: 'Could not load the active member roster, so badge names cannot be resolved. Reload to retry.',
          autoClose: false,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [status]);

  const displayNames = useMemo(
    () => computeDisplayNames(
      participants.map(p => ({ id: p.id, name: p.name ?? '' })),
      (memberCohort ?? []).map(m => ({ id: m.id, name: m.name ?? '' })),
    ),
    [participants, memberCohort],
  );

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  // Every count, every checkbox and the PDF itself read `visible`/`selectedVisible`,
  // never `participants`/`selectedIds` — a hidden person can't leak into a print run.
  const visible = hideInactive ? participants.filter(p => p.isMember) : participants;
  const selectedVisible = visible.filter(p => selectedIds.has(p.id));

  const toggleAll = () => {
    if (selectedVisible.length === visible.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map(p => p.id)));
    }
  };

  const generate = async (kind: 'badge' | 'sticker') => {
    if (selectedVisible.length === 0) return;
    // Badges carry the disambiguated name; stickers carry the full one, so only badges need the cohort.
    if (kind === 'badge' && !memberCohort) return;
    setIsGenerating(true);

    try {
      // Add QR code data URIs
      const badgesWithQr = await Promise.all(
        selectedVisible.map(async (p) => {
          const qrDataUri = await QRCode.toDataURL(p.id.toString(), {
            width: 200,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' }
          });
          // StickerDocument prints `name` raw; BadgeDocument prints `displayName`, the one
          // disambiguated against the active membership.
          return {
            id: p.id,
            name: p.name ?? '',
            displayName: displayNames.get(p.id) ?? '',
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
      notifications.show({ color: 'red', message: `Failed to generate ${kind} PDF. Please try again.`, autoClose: false });
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
          checked={visible.length > 0 && selectedVisible.length === visible.length}
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
      header: 'Badge name',
      render: (p) => (memberCohort
        ? <Text>{displayNames.get(p.id) || `User #${p.id}`}</Text>
        : <Text c="dimmed">—</Text>),
    },
    {
      header: 'Membership',
      render: (p) => (p.isMember ? <Text c="green">Active</Text> : <Text c="red">Inactive</Text>),
    },
    {
      header: 'Roles',
      render: (p) => (
        <Group gap={4}>
          {p.isBoardMember && <Badge size="xs" color="blue">BOARD</Badge>}
          {p.isKeyholder && <Badge size="xs" color="orange">KEYHOLDER</Badge>}
          {!p.isBoardMember && !p.isKeyholder && p.isMember && (
            <Badge size="xs">MEMBER</Badge>
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
        <Checkbox
          label="Hide inactive"
          checked={hideInactive}
          onChange={(e) => setHideInactive(e.currentTarget.checked)}
        />
        <Button onClick={() => generate('badge')} disabled={selectedVisible.length === 0 || isGenerating || !memberCohort} loading={isGenerating}>
          Generate Badge ({selectedVisible.length})
        </Button>
        <Button color="grape" onClick={() => generate('sticker')} disabled={selectedVisible.length === 0 || isGenerating} loading={isGenerating}>
          Generate Sticker ({selectedVisible.length})
        </Button>
      </Group>

      <DataTable
        columns={columns}
        rows={visible}
        getRowKey={(p) => p.id}
        loading={loading}
        emptyMessage="No participants found."
        rowProps={(p) => ({ bg: selectedIds.has(p.id) ? 'var(--mantine-color-blue-light)' : undefined })}
      />
    </Stack>
  );
}
