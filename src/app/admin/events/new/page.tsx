"use client";

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Center, Checkbox, Container, Group, Loader, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { AlertBanner } from '@/components/admin/AlertBanner';

const DAYS_MAP = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

function NewEventForm() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [programs, setPrograms] = useState<{ id: number, name: string }[]>([]);

  const [name, setName] = useState("");
  const [description] = useState("");
  const [programId, setProgramId] = useState(searchParams.get('programId') || "");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // Recurrence
  const [repeats, setRepeats] = useState(false);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [until, setUntil] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fetchPrograms = useCallback(async () => {
    try {
      const res = await fetch('/api/programs');
      if (res.ok) {
        setPrograms(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchPrograms();
    }
  }, [status, router, fetchPrograms]);

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    if (repeats && (daysOfWeek.length === 0 || !until)) {
      setMessage("Please select at least one day of the week and an end date for recurring events.");
      setSaving(false);
      return;
    }

    try {
      interface EventPayload {
        name: string;
        description: string;
        programId: number | null;
        startDate: string;
        startTime: string;
        endTime: string;
        recurrence?: { daysOfWeek: number[]; until: string };
      }

      const payload: EventPayload = {
        name,
        description,
        programId: programId ? parseInt(programId) : null,
        startDate,
        startTime,
        endTime
      };

      if (repeats) {
        payload.recurrence = { daysOfWeek, until };
      }

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        router.push(programId ? `/admin/programs/${programId}` : '/programs');
      } else {
        const err = await res.json();
        setMessage(err.error || "Failed to create event");
      }
    } catch {
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  const cancelHref = programId ? `/admin/programs/${programId}` : '/programs';

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" align="center" wrap="wrap" mb="lg">
        <Title order={1}>Schedule Event</Title>
        <Button component={Link} href={cancelHref} variant="default">Cancel</Button>
      </Group>

      <AlertBanner message={message} tone="error" mb="md" />

      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Event Name"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Session 1: Intro to Woodworking"
          />

          <Select
            label="Associated Program"
            value={programId}
            onChange={(v) => setProgramId(v ?? "")}
            data={[
              { value: "", label: "-- None (Standalone Event) --" },
              ...programs.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
          />

          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput type="date" label={repeats ? 'Start Date' : 'Date'} required value={startDate} onChange={(e) => setStartDate(e.currentTarget.value)} />
            <TextInput type="time" label="Start Time" required value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} />
            <TextInput type="time" label="End Time" required value={endTime} onChange={(e) => setEndTime(e.currentTarget.value)} />
          </SimpleGrid>

          <Card withBorder radius="md" padding="md">
            <Checkbox
              checked={repeats}
              onChange={(e) => setRepeats(e.currentTarget.checked)}
              label="Generate Recurring Events"
            />

            {repeats && (
              <Stack mt="md">
                <div>
                  <Text fw={500} mb="xs">Repeat on Days:</Text>
                  <Group gap="xs">
                    {DAYS_MAP.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={daysOfWeek.includes(day.value) ? 'filled' : 'default'}
                        onClick={() => toggleDay(day.value)}
                      >
                        {day.label}
                      </Button>
                    ))}
                  </Group>
                </div>
                <TextInput
                  type="date"
                  label="Ends On"
                  required={repeats}
                  value={until}
                  onChange={(e) => setUntil(e.currentTarget.value)}
                  description="Events will be generated individually up to this date."
                  maw={300}
                />
              </Stack>
            )}
          </Card>

          <Button type="submit" color="green" disabled={saving} loading={saving} mt="sm">
            Create Event(s)
          </Button>
        </Stack>
      </form>
    </Card>
  );
}

export default function NewEventPage() {
  return (
    <Container size="md" py="md">
      <Suspense fallback={<Center mih="60vh"><Loader /></Center>}>
        <NewEventForm />
      </Suspense>
    </Container>
  );
}
