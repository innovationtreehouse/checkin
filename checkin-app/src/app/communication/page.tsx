"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Center, Checkbox, Container, Loader, Stack, Text, Title } from '@mantine/core';

export default function CommunicationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [settings, setSettings] = useState({
    emailCheckinReceipts: false,
    emailNewsletter: false,
    notifyNewPrograms: true,
    notifyEventReminders: true
  });

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        const s = data.profile.notificationSettings || {};
        setSettings({
          emailCheckinReceipts: s.emailCheckinReceipts || false,
          emailNewsletter: s.emailNewsletter || false,
          notifyNewPrograms: s.notifyNewPrograms !== undefined ? s.notifyNewPrograms : true,
          notifyEventReminders: s.notifyEventReminders !== undefined ? s.notifyEventReminders : true
        });
      } else {
        setMessage("Failed to load settings.");
      }
    } catch {
      setMessage("Network error loading settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchSettings();
    }
  }, [status, router, fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationSettings: settings })
      });
      setMessage(res.ok ? "Settings updated successfully!" : "Failed to update settings.");
    } catch {
      setMessage("Network error saving settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null; // Fallback while router redirects

  return (
    <Container size="sm" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Title order={1}>Communication</Title>
        <Text c="dimmed" mb="lg">Manage your email and notification preferences.</Text>

        <Stack>
          <Checkbox
            checked={settings.emailCheckinReceipts}
            onChange={(e) => setSettings({ ...settings, emailCheckinReceipts: e.currentTarget.checked })}
            label="Email me when I check in or out"
          />
          <Checkbox
            checked={settings.emailNewsletter}
            onChange={(e) => setSettings({ ...settings, emailNewsletter: e.currentTarget.checked })}
            label="Subscribe to the weekly newsletter"
          />
          <Checkbox
            checked={settings.notifyNewPrograms}
            onChange={(e) => setSettings({ ...settings, notifyNewPrograms: e.currentTarget.checked })}
            label="Notify me when a new program is announced"
          />
          <Checkbox
            checked={settings.notifyEventReminders}
            onChange={(e) => setSettings({ ...settings, notifyEventReminders: e.currentTarget.checked })}
            label="Notify me before my events start"
          />
        </Stack>
        <Button onClick={handleSave} disabled={saving} loading={saving} fullWidth mt="lg" color="green">
          Update Settings
        </Button>

        {message && <Alert color={message.includes('success') ? 'green' : 'red'} mt="md">{message}</Alert>}
      </Card>
    </Container>
  );
}
