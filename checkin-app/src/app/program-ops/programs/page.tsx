"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";

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

  return (
    <Stack>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Programs</Title>
          <Text c="dimmed">Manage recurring programs and curriculum tracks.</Text>
        </div>
        <Button color="green" onClick={() => router.push('/program-ops/new')}>
          + New Program
        </Button>
      </Group>

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : programs.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">No programs found. Create your first one!</Text>
        </Card>
      ) : (
        <Stack gap="sm">
          {programs.map((program) => (
            <Card
              key={program.id}
              withBorder
              radius="md"
              padding="md"
              onClick={() => router.push(`/program-ops/programs/${program.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text fw={600}>{program.name}</Text>
                  <Text size="sm" c="dimmed">
                    {program._count?.participants || 0} Participants • {program._count?.events || 0} Events
                  </Text>
                </div>
                <Group gap="xs">
                  {program.phase === 'PLANNING' && (
                    <Badge color="yellow" variant="light">Planning / Not Published</Badge>
                  )}
                  <Badge color={program.memberOnly ? 'grape' : 'blue'} variant="light">
                    {program.memberOnly ? 'Member Only' : 'Public'}
                  </Badge>
                  <Text fz="lg">→</Text>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
