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
  // Every ACTIVE member org-wide — the population printed names disambiguate against.
  // Separate from `participants`, which is whatever the search box last matched.
  // `year` is per person: only a household that settled this renewal cycle gets one.
  const [roster, setRoster] = useState<{ id: number; name: string; year: string | null }[] | null>(null);
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

  // Once on mount — deliberately NOT keyed on searchTerm. The printed name must not
  // move when the operator types.
  useEffect(() => {
    if (status !== "authenticated") return;
    const url = new URL('/api/people/search', window.location.origin);
    url.searchParams.set('roster', 'active');
    fetch(url.toString())
      // apiError returns valid JSON, so a 500 would resolve to `[]` and release the
      // Generate guard — the roster must stay null on any failure.
      .then(res => {
        if (!res.ok) throw new Error(`roster request failed: ${res.status}`);
        return res.json();
      })
      .then(data => setRoster(data.people ?? []))
      .catch(e => {
        console.error("Failed to load the active-member roster for badge names:", e);
        setRoster(null);
        notifications.show({ color: 'red', message: 'Could not load the active member roster, so badge names cannot be resolved. Reload to retry.', autoClose: false });
      });
  }, [status]);

  const printedNames = useMemo(() => computeDisplayNames(roster ?? []), [roster]);
  const printedYears = useMemo(() => new Map((roster ?? []).map(m => [m.id, m.year])), [roster]);

  // The badge name and this column read the same map, so the column is proof of what
  // will print. Someone off the ACTIVE roster is not in that population at all, so
  // they get a bare first name rather than being folded into it — folding them in is
  // what lets a non-member move a member's name, which is the bug.
  const printedName = (p: ParticipantRow) =>
    printedNames.get(p.id) ?? ((p.name ?? '').trim().split(/\s+/)[0] || `User #${p.id}`);

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
          // `displayName` is the badge's; `name` is retained solely for StickerDocument,
          // which prints the full name raw and is not changing.
          return {
            id: p.id,
            name: p.name ?? '',
            displayName: printedName(p),
            year: printedYears.get(p.id) ?? null,
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
      header: 'Printed Name',
      render: (p) => <Text>{printedName(p)}</Text>,
    },
    {
      header: 'Membership',
      render: (p) => (p.isMember ? <Text c="green">Active</Text> : <Text c="red">Inactive</Text>),
    },
    {
      // Blank here means blank on the badge — the renewal prompt, visible before printing.
      header: 'Year',
      render: (p) => <Text c={printedYears.get(p.id) ? undefined : 'dimmed'}>{printedYears.get(p.id) ?? 'Not renewed'}</Text>,
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
        {/* Held until the roster lands: printing first would silently emit un-disambiguated
            names onto physical badges, with nothing on screen to say so. */}
        <Button onClick={() => generate('badge')} disabled={selectedVisible.length === 0 || isGenerating || roster === null} loading={isGenerating}>
          Generate Badge ({selectedVisible.length})
        </Button>
        <Button color="grape" onClick={() => generate('sticker')} disabled={selectedVisible.length === 0 || isGenerating || roster === null} loading={isGenerating}>
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
