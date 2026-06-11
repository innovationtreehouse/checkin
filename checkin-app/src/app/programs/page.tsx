"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Center, Checkbox, Divider, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDate } from '@/lib/time';

type ProgramSummary = {
  id: number;
  name: string;
  begin: string | null;
  end: string | null;
  memberOnly: boolean;
  phase: string;
  enrollmentStatus: string;
  leadMentorId: number | null;
  _count: {
    participants: number;
    volunteers: number;
    events: number;
  };
};

export default function PublicProgramsDirectory() {
  const { data: session } = useSession();
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const isAuthorized = session && (session.user?.sysadmin || session.user?.boardMember);

  useEffect(() => {
    const fetchPrograms = async () => {
      setLoading(true);
      try {
        const query = (isAuthorized && !activeOnly) ? '' : '?active=true';
        const res = await fetch(`/api/programs${query}`);
        if (res.ok) {
          const data = await res.json();
          setPrograms(data);
        } else {
          setMessage("Failed to load program directory.");
        }
      } catch {
        setMessage("Network error loading programs.");
      } finally {
        setLoading(false);
      }
    };

    fetchPrograms();
  }, [activeOnly, isAuthorized]);

  if (loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Programs Directory</Title>
          <Text c="dimmed" mt="xs">
            Discover courses, certifications, and group activities at the Treehouse.
          </Text>
        </div>
        {isAuthorized && (
          <Group gap="lg" wrap="wrap">
            <Checkbox
              label="Show active only"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.currentTarget.checked)}
            />
            <Button component={Link} href="/admin/programs/new" color="green" variant="light">
              + New Program
            </Button>
          </Group>
        )}
      </Group>

      {message && <Alert color="red">{message}</Alert>}

      {programs.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">No active programs currently available. Check back soon!</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {programs.map((program) => {
            const canManage = session && (session.user?.sysadmin || session.user?.boardMember || session.user?.id === program.leadMentorId);
            return (
              <Card key={program.id} withBorder radius="md" padding="lg">
                <Group justify="space-between" align="flex-start" mb="sm">
                  <Title order={4}>{program.name}</Title>
                  <Group gap={4}>
                    {program.memberOnly && <Badge color="grape" variant="light">Member Only</Badge>}
                    {program.phase === 'PLANNING' && <Badge color="yellow" variant="light">Planning</Badge>}
                    {program.enrollmentStatus === 'CLOSED' && <Badge color="red" variant="light">Closed</Badge>}
                  </Group>
                </Group>

                <Text c="dimmed" style={{ flex: 1 }} mb="md">
                  {program.begin ? formatDate(program.begin) : 'Start Date TBD'}
                  {program.end ? ` - ${formatDate(program.end)}` : ' (Ongoing)'}
                </Text>

                <Card withBorder radius="sm" padding="xs" mb="md">
                  <Group justify="space-around">
                    <Stack gap={0} align="center">
                      <Text fw={700}>{program._count.participants}</Text>
                      <Text size="xs" c="dimmed">Enrolled</Text>
                    </Stack>
                    <Divider orientation="vertical" />
                    <Stack gap={0} align="center">
                      <Text fw={700}>{program._count.volunteers}</Text>
                      <Text size="xs" c="dimmed">Volunteers</Text>
                    </Stack>
                    <Divider orientation="vertical" />
                    <Stack gap={0} align="center">
                      <Text fw={700}>{program._count.events}</Text>
                      <Text size="xs" c="dimmed">Sessions</Text>
                    </Stack>
                  </Group>
                </Card>

                <Group grow>
                  <Button component={Link} href={`/programs/${program.id}`} variant="light">
                    View Details
                  </Button>
                  {canManage && (
                    <Button component={Link} href={`/admin/programs/${program.id}`} variant="light" color="green">
                      Manage
                    </Button>
                  )}
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
