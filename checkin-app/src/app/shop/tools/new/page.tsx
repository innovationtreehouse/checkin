"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Card, Center, Container, Group, Loader, Stack, Text, TextInput, Title } from '@mantine/core';

export default function CreateToolPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [newToolName, setNewToolName] = useState("");
  const [newToolGuide, setNewToolGuide] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch('/api/shop/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newToolName, safetyGuide: newToolGuide })
      });

      if (res.ok) {
        setMessage("New tool added successfully!");
        setNewToolName("");
        setNewToolGuide("");
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to create tool.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  const isAdmin = session?.user?.boardMember || session?.user?.sysadmin;

  if (!isAdmin) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">
            Forbidden: Only Admins and Board Members can define new tools.
          </Alert>
          <Button onClick={() => router.push('/shop')}>Back to Shop Ops</Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="sm" py="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="md">
          <Title order={1}>Register New Tool</Title>
          <Button component={Link} href="/shop" variant="default">← Shop Dashboard</Button>
        </Group>

        <Text c="dimmed" mb="lg">
          Define a new piece of shop equipment to begin tracking safety certifications, authorizing
          Certifiers, and tracking usage.
        </Text>

        {message && (
          <Alert color={message.includes('success') ? 'green' : 'red'} mb="md">{message}</Alert>
        )}

        <form onSubmit={handleCreateTool}>
          <Stack>
            <TextInput
              label="Equipment Name"
              required
              placeholder="e.g. SawStop Table Saw"
              value={newToolName}
              onChange={(e) => setNewToolName(e.currentTarget.value)}
            />
            <TextInput
              type="url"
              label="Safety Guide URL"
              placeholder="https://example.com/safety-manual"
              description="Optional link to the required reading or manufacturer manual."
              value={newToolGuide}
              onChange={(e) => setNewToolGuide(e.currentTarget.value)}
            />
            <Button type="submit" disabled={saving} loading={saving} mt="sm">
              Create Tool
            </Button>
          </Stack>
        </form>
      </Card>
    </Container>
  );
}
