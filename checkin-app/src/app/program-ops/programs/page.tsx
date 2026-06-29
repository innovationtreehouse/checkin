"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Anchor, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";

type Program = {
  id: number;
  name: string;
  phase?: string;
  memberOnly?: boolean;
  _count?: { participants?: number; events?: number };
};

export default function AdminProgramsIndex() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
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

  const columns: DataTableColumn<Program>[] = [
    {
      header: "Program",
      render: (p) => <Text fw={600}>{p.name}</Text>,
      sortBy: (p) => p.name,
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
      header: "Status",
      render: (p) => (
        <Group gap="xs" wrap="nowrap">
          {p.phase === 'PLANNING' && (
            <Badge color="yellow" variant="light">Planning / Not Published</Badge>
          )}
          <Badge color={p.memberOnly ? 'grape' : 'blue'} variant="light">
            {p.memberOnly ? 'Member Only' : 'Public'}
          </Badge>
        </Group>
      ),
      sortBy: (p) => p.phase === 'PLANNING' ? 'Planning' : (p.memberOnly ? 'Member Only' : 'Public'),
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

      <DataTable
        columns={columns}
        rows={programs}
        getRowKey={(p) => p.id}
        loading={loading}
        emptyMessage="No programs found. Create your first one!"
      />
    </Stack>
  );
}
