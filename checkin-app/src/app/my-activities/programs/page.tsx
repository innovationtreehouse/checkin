"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Container, Group, SimpleGrid, Text, Title } from '@mantine/core';
import { formatDateOnly } from '@/lib/time';

import { PageLoader } from "@/components/ui/PageLoader";
type UserProgram = {
  programId: number;
  personId: number;
  status: 'PENDING' | 'ACTIVE';
  isPaymentPlanRequested: boolean;
  person: { id: number; name: string | null };
  program: {
    id: number;
    name: string;
    startAt: string | null;
    endAt: string | null;
  };
};

// Payment pill: ACTIVE (paid/free) shows nothing; a still-owed enrollment is
// either the household's to pay (theme-primary, actionable) or waiting on finance to
// approve a payment plan (gray, not actionable — don't imply it's settled).
// ponytail: "Payment due" reads more like a warning than a success state — mechanical
// off-palette-sweep target is theme-primary green; a maintainer may prefer gray/yellow here.
function paymentPill(status: string, planRequested: boolean, viewerIsYouth: boolean) {
  if (status === 'ACTIVE') return null;
  // A youth is shown no payment state at all — "Awaiting confirmation" is true
  // whoever owes it (docs/rules/programs.md, "What a youth sees of money").
  if (viewerIsYouth) return <Badge color="gray" variant="filled">Awaiting confirmation</Badge>;
  return planRequested
    ? <Badge color="gray" variant="filled">Awaiting finance approval</Badge>
    : <Badge variant="filled">Payment due</Badge>;
}

export default function MyProgramsDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // See docs/rules/programs.md — a youth sees no payment state.
  const viewerIsYouth = (session?.user as { ageBand?: string } | undefined)?.ageBand === 'youth';

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
      <PageLoader />
    );
  }

  if (!session) return null;

  // A household lead sees the whole household, so label each card with whose
  // enrollment it is. A solo user only ever sees their own — no label needed.
  const showMembers = !!session.user.householdLead;

  return (
    <Container size="lg" pb="md">
      <Title order={1} mb="md">My Programs</Title>

      <Text c="dimmed" mb="lg">
        {showMembers
          ? 'Manage the programs you and your family are currently enrolled in.'
          : 'Manage the programs you are currently enrolled in.'}
      </Text>

      {error && (
        <Alert color="red" variant="light" mb="lg">
          {error}
        </Alert>
      )}

      {loading ? (
        <PageLoader minHeight="30vh" />
      ) : enrollments.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Text c="dimmed">You are not enrolled in any programs yet.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {enrollments.map(({ program, personId, person, status: enrollStatus, isPaymentPlanRequested }) => (
            <Card key={`${program.id}-${personId}`} withBorder radius="md" padding="lg">
              <Group gap="xs" mb="sm">
                {showMembers && (
                  <Badge variant="light">{person.name ?? 'Member'}</Badge>
                )}
                {paymentPill(enrollStatus, isPaymentPlanRequested, viewerIsYouth)}
              </Group>
              <Title order={4} mb="sm">{program.name}</Title>
              <Text c="dimmed" style={{ flex: 1 }}>
                {program.startAt ? formatDateOnly(program.startAt) : 'Start Date TBD'}
                {program.endAt ? ` - ${formatDateOnly(program.endAt)}` : ' (Ongoing)'}
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
