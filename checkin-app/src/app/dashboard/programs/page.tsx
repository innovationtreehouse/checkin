"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Card, Center, Container, Group, Loader, SimpleGrid, Text, Title } from '@mantine/core';
import { formatDate } from '@/lib/time';

type UserProgram = {
  programId: number;
  program: {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
  };
};

export default function MyProgramsDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [enrollments] = useState<UserProgram[]>([]);

  // Fetching 'my programs' requires a dedicated backend query which we will add in the final
  // polish. This UI is ready for it.
  const note =
    "Note: Fetching 'my programs' requires a dedicated backend query which we will add in the final polish. This UI is ready for it.";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (!session) return null;

  return (
    <Container size="lg" pb="md">
      <Group justify="space-between" align="center" mb="md" wrap="wrap">
        <Title order={1}>My Programs</Title>
        <Button variant="default" onClick={() => router.push('/programs')}>
          Browse More Programs
        </Button>
      </Group>

      <Text c="dimmed" mb="lg">
        Manage the programs you are currently enrolled in.
      </Text>

      {note && (
        <Alert color="red" variant="light" mb="lg">
          {note}
        </Alert>
      )}

      {enrollments.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">You are not enrolled in any programs yet.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {enrollments.map(({ program }) => (
            <Card key={program.id} withBorder radius="md" padding="lg">
              <Title order={4} mb="sm">{program.name}</Title>
              <Text c="dimmed" style={{ flex: 1 }}>
                {program.begin ? formatDate(program.begin) : 'Start Date TBD'}
                {program.end ? ` - ${formatDate(program.end)}` : ' (Ongoing)'}
              </Text>
              <Button component={Link} href={`/programs/${program.id}`} variant="light" fullWidth mt="md">
                View Details
              </Button>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Container>
  );
}
