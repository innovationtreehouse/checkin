"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Anchor, Badge, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";

type Program = {
  id: number;
  name: string;
  phase?: string;
  memberOnly?: boolean;
  begin?: string | null;
  end?: string | null;
  _count?: { participants?: number; events?: number };
};

const PHASE_LABELS: Record<string, string> = {
  PLANNING: "Planning",
  UPCOMING: "Upcoming",
  RUNNING: "Running",
  FINISHED: "Finished",
};
const PHASE_COLORS: Record<string, string> = {
  PLANNING: "yellow",
  UPCOMING: "blue",
  RUNNING: "green",
  FINISHED: "gray",
};

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

const dateRange = (p: Program) => {
  const b = fmtDate(p.begin);
  const e = fmtDate(p.end);
  if (!b && !e) return "—";
  if (b && e) return `${b} – ${e}`;
  return b ?? e;
};

export default function AdminProgramsIndex() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(false);
  const [publicOnly, setPublicOnly] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/programs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPrograms(data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const visiblePrograms = programs.filter(
    (p) =>
      (!activeOnly || p.phase !== "FINISHED") &&
      (!publicOnly || (p.phase !== "PLANNING" && !p.memberOnly)),
  );

  const columns: DataTableColumn<Program>[] = [
    {
      header: "Program",
      render: (p) => <Text fw={600}>{p.name}</Text>,
      sortBy: (p) => p.name,
    },
    {
      header: "Dates",
      render: (p) => dateRange(p),
      sortBy: (p) => p.begin ?? "",
    },
    {
      header: "Phase",
      render: (p) => (
        <Badge color={PHASE_COLORS[p.phase ?? ""] ?? "gray"} variant="light">
          {PHASE_LABELS[p.phase ?? ""] ?? p.phase ?? "—"}
        </Badge>
      ),
      sortBy: (p) => p.phase ?? "",
    },
    {
      header: "Participants",
      align: "right",
      render: (p) => p._count?.participants ?? 0,
      sortBy: (p) => p._count?.participants ?? 0,
    },
    {
      header: "Events",
      align: "right",
      render: (p) => p._count?.events ?? 0,
      sortBy: (p) => p._count?.events ?? 0,
    },
    {
      header: "Visibility",
      render: (p) => (
        <Badge color={p.memberOnly ? 'grape' : 'blue'} variant="light">
          {p.memberOnly ? 'Member Only' : 'Public'}
        </Badge>
      ),
      sortBy: (p) => (p.memberOnly ? 'Member Only' : 'Public'),
    },
    {
      header: "",
      align: "right",
      render: (p) => (
        <Anchor component={Link} href={`/program-ops/programs/${p.id}`} fw={500}>
          View →
        </Anchor>
      ),
    },
  ];

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Text c="dimmed">Manage recurring programs and curriculum tracks.</Text>
        <Button color="green" onClick={() => router.push('/program-ops/new')}>
          + New Program
        </Button>
      </Group>

      <Group gap="lg">
        <Checkbox
          label="Only show active"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.currentTarget.checked)}
        />
        <Checkbox
          label="Only show publicly visible"
          checked={publicOnly}
          onChange={(e) => setPublicOnly(e.currentTarget.checked)}
        />
      </Group>

      <DataTable
        columns={columns}
        rows={visiblePrograms}
        getRowKey={(p) => p.id}
        loading={loading}
        emptyMessage="No programs found. Create your first one!"
      />
    </Stack>
  );
}
