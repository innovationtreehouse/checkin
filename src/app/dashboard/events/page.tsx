"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDateTime } from '@/lib/time';

type RsvpStatus = "ATTENDING" | "NOT_ATTENDING" | "MAYBE";

type EventData = {
  id: number;
  name: string;
  description: string | null;
  start: string;
  end: string;
  program: { name: string } | null;
  rsvps: { status: RsvpStatus }[];
};

const RSVP_OPTIONS: { status: RsvpStatus; label: string; color: string }[] = [
  { status: 'ATTENDING', label: 'Yes', color: 'green' },
  { status: 'MAYBE', label: 'Maybe', color: 'yellow' },
  { status: 'NOT_ATTENDING', label: 'No', color: 'red' },
];

export default function ParticipantEventsDashboard() {
  const { status } = useSession();
  const router = useRouter();
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events/mine');
      if (res.ok) {
        setEvents(await res.json());
      } else {
        setMessage("Failed to load your events.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchEvents();
    }
  }, [status, router, fetchEvents]);

  const handleRSVP = async (eventId: number, newStatus: RsvpStatus) => {
    // Optimistic update
    setEvents(prev => prev.map(ev =>
      ev.id === eventId ? { ...ev, rsvps: [{ status: newStatus }] } : ev
    ));

    try {
      await fetch(`/api/events/${eventId}/rsvp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch {
      // Revert on failure by refetching
      fetchEvents();
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  return (
    <Stack>
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>My Upcoming Events</Title>
        <Button component={Link} href="/dashboard" variant="default">← Back to Dashboard</Button>
      </Group>

      {message && <Alert color="red">{message}</Alert>}

      {events.length === 0 ? (
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={3}>No Upcoming Events</Title>
          <Text c="dimmed" mt="sm">
            You have no scheduled events for the programs you are enrolled in.
          </Text>
          <Group justify="center" mt="lg">
            <Button component={Link} href="/programs" variant="light">Browse Programs</Button>
          </Group>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {events.map((ev) => {
            const userRSVP = ev.rsvps.length > 0 ? ev.rsvps[0].status : null;
            const startStr = formatDateTime(ev.start, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            return (
              <Card key={ev.id} withBorder radius="md" padding="lg">
                <Stack gap="sm" h="100%">
                  <div>
                    {ev.program && (
                      <Text size="xs" c="cyan" fw={600} tt="uppercase">{ev.program.name}</Text>
                    )}
                    <Title order={4}>{ev.name}</Title>
                    <Text size="sm" c="dimmed">📅 {startStr}</Text>
                  </div>

                  {ev.description && (
                    <Text size="sm" lineClamp={2}>{ev.description}</Text>
                  )}

                  <div style={{ marginTop: 'auto' }}>
                    <Text size="sm" c="dimmed" mb={4}>RSVP Status:</Text>
                    <Button.Group>
                      {RSVP_OPTIONS.map((opt) => (
                        <Button
                          key={opt.status}
                          fullWidth
                          variant={userRSVP === opt.status ? 'filled' : 'default'}
                          color={opt.color}
                          onClick={() => handleRSVP(ev.id, opt.status)}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </Button.Group>
                  </div>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
