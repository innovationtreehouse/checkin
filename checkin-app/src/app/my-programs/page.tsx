"use client";

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Badge, Button, Card, Group, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconCalendarCheck } from '@tabler/icons-react';
import { useTodoCounts } from '@/hooks/useTodoCounts';
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';

type LedProgram = NonNullable<TodoCounts['lead']>['programs'][number];

/**
 * Attendance-inbox subtab of staff "My Programs". Lists the programs the caller
 * runs and surfaces the same pending attendance the post-event email targets,
 * deep-linking to the existing confirm screen. Pure navigation + surfacing.
 *
 * Section chrome (title, subtabs) and the lead-gate / loading state live in
 * layout.tsx; this renders only the inbox content.
 */
export default function MyProgramsHome() {
  const { status } = useSession();
  const counts = useTodoCounts(status === 'authenticated');

  const programs = counts?.lead?.programs ?? [];
  if (programs.length === 0) return null; // layout shows loader / redirects non-leads

  if (programs.length === 1) return <ProgramSection program={programs[0]} />;

  return (
    <Tabs defaultValue="all">
      <Tabs.List mb="md">
        <Tabs.Tab value="all">All Programs</Tabs.Tab>
        {programs.map((p) => (
          <Tabs.Tab key={p.id} value={String(p.id)} rightSection={p.pending.length > 0 ? <Badge size="sm" circle color="treehouseGreen">{p.pending.length}</Badge> : undefined}>
            {p.name}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value="all">
        <Stack>
          {programs.map((p) => <ProgramSection key={p.id} program={p} />)}
        </Stack>
      </Tabs.Panel>
      {programs.map((p) => (
        <Tabs.Panel key={p.id} value={String(p.id)}>
          <ProgramSection program={p} />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function ProgramSection({ program }: { program: LedProgram }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={3}>{program.name}</Title>
        <Button component={Link} href={`/program-ops/programs/${program.id}`} variant="subtle" size="xs">
          Manage
        </Button>
      </Group>
      {program.pending.length === 0 ? (
        <Text c="dimmed" size="sm">No attendance to confirm.</Text>
      ) : (
        <Stack gap="xs">
          <Text fw={600} size="sm">Attendance to confirm</Text>
          {program.pending.map((item) => (
            <Button
              key={item.key}
              component={Link}
              href={item.href}
              variant="light"
              color="treehouseGreen"
              justify="space-between"
              leftSection={<IconCalendarCheck size={16} />}
              fullWidth
            >
              {item.label}
            </Button>
          ))}
        </Stack>
      )}
    </Card>
  );
}
