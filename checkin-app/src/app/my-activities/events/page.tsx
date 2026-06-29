"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDateTime, formatTime } from '@/lib/time';

type RsvpStatus = "ATTENDING" | "NOT_ATTENDING" | "MAYBE";

// One row per (event, household member) — a lead sees a card per family member.
type EventData = {
  id: number;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  program: { name: string } | null;
  participant: { id: number; name: string | null };
  rsvp: RsvpStatus | null;
};

// Group (event, member) rows into one bucket per event, preserving first-seen order.
function groupByEvent(events: EventData[]): EventData[][] {
  const byId = new Map<number, EventData[]>();
  for (const ev of events) {
    const rows = byId.get(ev.id);
    if (rows) rows.push(ev);
    else byId.set(ev.id, [ev]);
  }
  return [...byId.values()];
}

const RSVP_OPTIONS: { status: RsvpStatus; label: string; color: string }[] = [
  { status: 'ATTENDING', label: 'Yes', color: 'green' },
  { status: 'MAYBE', label: 'Maybe', color: 'yellow' },
  { status: 'NOT_ATTENDING', label: 'No', color: 'red' },
];

export default function ParticipantEventsDashboard() {
  const { data: session, status } = useSession();
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

  const handleRSVP = async (eventId: number, participantId: number, newStatus: RsvpStatus) => {
    // Optimistic update — only the targeted member's card.
    setEvents(prev => prev.map(ev =>
      ev.id === eventId && ev.participant.id === participantId ? { ...ev, rsvp: newStatus } : ev
    ));

    try {
      await fetch(`/api/events/${eventId}/rsvp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, participantId })
      });
    } catch {
      // Revert on failure by refetching
      fetchEvents();
    }
  };

  // A household lead sees every member's events, so label whose each card is.
  const showMembers = !!session?.user.householdLead;

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  return (
    <Stack>
      <Title order={1}>My Upcoming Events</Title>

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
          {groupByEvent(events).map((rows) => {
            const ev = rows[0];
            const startStr = formatDateTime(ev.startAt, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const endStr = formatTime(ev.endAt, { hour: '2-digit', minute: '2-digit' });
            // Multi-member cards must always show whose RSVP is whose, even for non-leads.
            const labelMembers = showMembers || rows.length > 1;

            return (
              <Card key={ev.id} withBorder radius="md" padding="lg">
                <Stack gap="sm" h="100%">
                  <div>
                    {ev.program && (
                      <Text size="xs" c="cyan" fw={600} tt="uppercase">{ev.program.name}</Text>
                    )}
                    <Title order={4}>{ev.name}</Title>
                    <Text size="sm" c="dimmed">📅 {startStr} – {endStr}</Text>
                  </div>

                  {ev.description && (
                    <Text size="sm" lineClamp={2}>{ev.description}</Text>
                  )}

                  <Stack gap="xs" style={{ marginTop: 'auto' }}>
                    {rows.map((member) => (
                      <div key={member.participant.id}>
                        {labelMembers ? (
                          <Badge variant="light" mb={4}>{member.participant.name ?? 'Member'}</Badge>
                        ) : (
                          <Text size="sm" c="dimmed" mb={4}>RSVP Status:</Text>
                        )}
                        <Button.Group>
                          {RSVP_OPTIONS.map((opt) => (
                            <Button
                              key={opt.status}
                              fullWidth
                              variant={member.rsvp === opt.status ? 'filled' : 'default'}
                              color={opt.color}
                              onClick={() => handleRSVP(ev.id, member.participant.id, opt.status)}
                            >
                              {opt.label}
                            </Button>
                          ))}
                        </Button.Group>
                      </div>
                    ))}
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
