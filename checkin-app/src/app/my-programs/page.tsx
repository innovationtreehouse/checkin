"use client";

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button, Card, Center, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconCalendarCheck } from '@tabler/icons-react';
import { PageContainer } from '@/components/ui/PageContainer';
import { useTodoCounts } from '@/hooks/useTodoCounts';
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';
import { leadsAnyProgram } from '@/components/navBadges';

type LedProgram = NonNullable<TodoCounts['lead']>['programs'][number];

/**
 * Staff "My Programs" home — for program lead mentors. Lists the programs the
 * caller runs and surfaces the same pending attendance the post-event email
 * targets, deep-linking to the existing confirm screen. Pure navigation +
 * surfacing: every link lands on a route already gated to the lead.
 *
 * Lead status and the pending list both ride in on the todo-counts payload the
 * nav already fetches — no new endpoint, no new session field.
 */
export default function MyProgramsHome() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const counts = useTodoCounts(status === 'authenticated');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    // Authenticated but leads no program → not their home. Wait for counts to
    // load (null) before redirecting so we don't bounce a real lead mid-fetch.
    else if (status === 'authenticated' && counts !== null && !leadsAnyProgram(counts)) {
      router.push('/');
    }
  }, [status, counts, router]);

  if (status === 'loading' || counts === null || !session) {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  const programs = counts.lead?.programs ?? [];
  if (programs.length === 0) return null; // redirect in flight

  return (
    <PageContainer>
      <Title order={1} mb="xs">My Programs</Title>
      <Text c="dimmed" mb="lg">Programs you lead, and attendance waiting on you.</Text>

      {programs.length === 1 ? (
        <ProgramSection program={programs[0]} />
      ) : (
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
      )}
    </PageContainer>
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
