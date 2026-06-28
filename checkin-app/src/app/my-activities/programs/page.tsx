"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Center, Container, Group, Loader, SimpleGrid, Text, Title } from '@mantine/core';
import { formatDate } from '@/lib/time';

type UserProgram = {
  programId: number;
  participantId: number;
  participant: { id: number; name: string | null };
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

  const [enrollments, setEnrollments] = useState<UserProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch('/api/programs/mine')
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setEnrollments)
      .catch(() => setError("Failed to load your programs."))
      .finally(() => setLoading(false));
  }, [status]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (!session) return null;

  // A household lead sees the whole household, so label each card with whose
  // enrollment it is. A solo user only ever sees their own — no label needed.
  const showMembers = !!session.user.householdLead;

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

      {error && (
        <Alert color="red" variant="light" mb="lg">
          {error}
        </Alert>
      )}

      {loading ? (
        <Center mih="30vh">
          <Loader />
        </Center>
      ) : enrollments.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">You are not enrolled in any programs yet.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {enrollments.map(({ program, participantId, participant }) => (
            <Card key={`${program.id}-${participantId}`} withBorder radius="md" padding="lg">
              {showMembers && (
                <Badge variant="light" mb="sm">{participant.name ?? 'Member'}</Badge>
              )}
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
