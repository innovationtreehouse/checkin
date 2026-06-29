"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Anchor, Button, Card, Center, Group, Loader, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { PageContainer } from '@/components/ui/PageContainer';
import { formatDate, formatTime, formatDateTime } from '@/lib/time';

type ProfileVisit = {
  id: number;
  arrivedAt: string;
  departedAt?: string | null;
  event?: { name?: string | null } | null;
};

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: ""
  });
  const [visits, setVisits] = useState<ProfileVisit[]>([]);
  const [filterDate, setFilterDate] = useState("");

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        setForm({
          name: data.profile.name || "",
          email: data.profile.email || "",
          phone: data.profile.phone || "",
          dob: data.profile.dateOfBirth ? new Date(data.profile.dateOfBirth).toISOString().split('T')[0] : ""
        });
      } else {
        setMessage("Failed to load profile.");
      }
    } catch {
      setMessage("Network error loading profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVisits = useCallback(async () => {
    try {
      const res = await fetch(`/api/profile/visits?date=${filterDate}`);
      if (res.ok) {
        const data = await res.json();
        setVisits(data.visits || []);
      }
    } catch (error) {
      console.error("Error fetching visits:", error);
    }
  }, [filterDate]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchProfile();
      fetchVisits();
    }
  }, [status, router, fetchProfile, fetchVisits]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          dob: form.dob || null
        })
      });

      if (res.ok) {
        setMessage("Profile updated successfully!");
      } else {
        setMessage("Failed to update profile.");
      }
    } catch {
      setMessage("Network error saving profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null; // Fallback while router redirects

  return (
    <PageContainer>
      <Stack maw={620}>
        <Card withBorder radius="md" padding="lg">
          <Title order={1}>My Profile</Title>
          <Text c="dimmed" mb="lg">Manage your personal information and contact details.</Text>

          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput label="Email Address" value={form.email} disabled title="Email cannot be changed here." />
              <TextInput label="Full Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} placeholder="e.g. Jane Doe" />
              <TextInput type="tel" label="Phone Number" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} placeholder="(555) 123-4567" />
              <TextInput type="date" label="Date of Birth" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.currentTarget.value })} />

              <Text size="sm" c="dimmed">
                Your address is managed on the <Anchor href="/my-household">Household</Anchor> page.
              </Text>

              <Button type="submit" disabled={saving} loading={saving} mt="sm">
                Save Profile
              </Button>
            </Stack>
          </form>

          {message && <Alert color={message.includes('success') ? 'green' : 'red'} mt="md">{message}</Alert>}
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" align="center" wrap="wrap" mb="xs">
            <Title order={2}>Recent Check-ins</Title>
            <TextInput
              type="date"
              label="Lookup Date"
              value={filterDate || new Date().toISOString().split('T')[0]}
              onChange={(e) => setFilterDate(e.currentTarget.value)}
              size="xs"
            />
          </Group>

          <Text size="sm" c="dimmed" mb="lg">
            {filterDate ? (
              <>Showing activity from <strong>{formatDate(new Date(filterDate).getTime() - 7 * 24 * 60 * 60 * 1000)}</strong> to <strong>{formatDate(new Date(filterDate).getTime() + 7 * 24 * 60 * 60 * 1000)}</strong></>
            ) : (
              <>Showing activity for the <strong>past 7 days</strong></>
            )}
          </Text>

          {visits.length === 0 ? (
            <Text c="dimmed">No historical visits found.</Text>
          ) : (
            <Stack gap="xs">
              {visits.map((v) => (
                <Paper key={v.id} withBorder radius="md" p="md">
                  <Group justify="space-between" wrap="wrap">
                    <div>
                      <Text fw={600}>{v.event?.name || 'General Facility Visit'}</Text>
                      <Text size="sm" c="dimmed">{formatDateTime(v.arrivedAt)}</Text>
                    </div>
                    <Text size="sm">
                      {v.departedAt ? (
                        <Text component="span" c="green">Departed {formatTime(v.departedAt)}</Text>
                      ) : (
                        <Text component="span" c="yellow">Active Visit</Text>
                      )}
                    </Text>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Card>
      </Stack>
    </PageContainer>
  );
}
