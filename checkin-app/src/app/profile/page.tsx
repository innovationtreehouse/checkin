"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Anchor, Button, Card, Center, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { PageContainer } from '@/components/ui/PageContainer';
import { AlertBanner, type AlertTone } from '@/components/admin/AlertBanner';
import { isYouth } from '@/lib/time';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: AlertTone } | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: ""
  });
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
        setMessage({ text: "Failed to load profile.", tone: "error" });
      }
    } catch {
      setMessage({ text: "Network error loading profile.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchProfile();
    }
  }, [status, router, fetchProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

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
        setMessage({ text: "Profile updated successfully!", tone: "success" });
      } else {
        setMessage({ text: "Failed to update profile.", tone: "error" });
      }
    } catch {
      setMessage({ text: "Network error saving profile.", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null; // Fallback while router redirects

  const readOnly = isYouth(form.dob);

  return (
    <PageContainer>
      <Card withBorder radius="md" padding="lg" maw={620}>
        <Title order={1}>My Profile</Title>
          <Text c="dimmed" mb="lg">
            {readOnly
              ? "View your personal information. Ask a parent or staff member to make changes."
              : "Manage your personal information and contact details."}
          </Text>

          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput label="Email Address" value={form.email} disabled title="Email cannot be changed here." />
              <TextInput label="Full Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} placeholder="e.g. Jane Doe" disabled={readOnly} />
              <TextInput type="tel" label="Phone Number" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} placeholder="(555) 123-4567" disabled={readOnly} />
              <TextInput type="date" label="Date of Birth" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.currentTarget.value })} disabled={readOnly} />

              <Text size="sm" c="dimmed">
                Your address is managed on the <Anchor href="/my-household">Household</Anchor> page.
              </Text>

              {!readOnly && (
                <Button type="submit" disabled={saving} loading={saving} mt="sm">
                  Save Profile
                </Button>
              )}
            </Stack>
          </form>

          <AlertBanner message={message?.text} tone={message?.tone} mb="md" />
      </Card>
    </PageContainer>
  );
}
