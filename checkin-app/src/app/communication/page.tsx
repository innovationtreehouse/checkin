"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Card, Center, Checkbox, Loader, Stack, Text, Title } from '@mantine/core';
import { PageContainer } from '@/components/ui/PageContainer';

export default function CommunicationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [settings, setSettings] = useState({
    emailCheckinReceipts: false,
    emailDependentCheckins: false,
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
          emailDependentCheckins: s.emailDependentCheckins || false,
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

  // Each toggle persists immediately — no save button. Optimistic flip,
  // revert on failure so a checkbox never lies about what's in the DB.
  const persist = async (patch: Partial<typeof settings>) => {
    const prev = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setMessage("");
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationSettings: next })
      });
      if (!res.ok) throw new Error();
    } catch {
      setSettings(prev);
      setMessage("Failed to update settings.");
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null; // Fallback while router redirects

  return (
    <PageContainer>
      <Card withBorder radius="md" padding="lg" maw={620}>
        <Title order={1}>Communication</Title>
        <Text c="dimmed" mb="lg">Manage your email and notification preferences.</Text>

        <Stack>
          <Checkbox
            checked={settings.emailCheckinReceipts}
            onChange={(e) => persist({ emailCheckinReceipts: e.currentTarget.checked })}
            label="Email me when I check in or out"
          />
          <Checkbox
            checked={settings.emailDependentCheckins}
            onChange={(e) => persist({ emailDependentCheckins: e.currentTarget.checked })}
            label="Email me realtime receipts when my dependents check in/out"
          />
          <Checkbox
            checked={settings.emailNewsletter}
            onChange={(e) => persist({ emailNewsletter: e.currentTarget.checked })}
            label="Subscribe to the monthly newsletter"
          />
          <Checkbox
            checked={settings.notifyNewPrograms}
            onChange={(e) => persist({ notifyNewPrograms: e.currentTarget.checked })}
            label="Notify me when a new program is announced"
          />
          <Checkbox
            checked={settings.notifyEventReminders}
            onChange={(e) => persist({ notifyEventReminders: e.currentTarget.checked })}
            label="Notify me before my events start"
          />
        </Stack>

        {message && <Alert color="red" mt="md">{message}</Alert>}
      </Card>
    </PageContainer>
  );
}
