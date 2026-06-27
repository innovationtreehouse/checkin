"use client";

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Center, Container, Group, Loader, Stack, Tabs, Text, TextInput, Title } from '@mantine/core';

export default function ShopOpsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [newToolName, setNewToolName] = useState("");
  const [newToolGuide, setNewToolGuide] = useState("");
  const [saving, setSaving] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setCreateMessage("");

    try {
      const res = await fetch('/api/shop/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newToolName, safetyGuide: newToolGuide })
      });

      if (res.ok) {
        setCreateMessage("New tool added successfully!");
        setNewToolName("");
        setNewToolGuide("");
      } else {
        const data = await res.json();
        setCreateMessage(data.error || "Failed to create tool.");
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  const isSysadmin = session?.user?.sysadmin;
  const isBoardMember = session?.user?.boardMember;
  const isAdmin = isSysadmin || isBoardMember;

  // Certifier check: Board Member, Admin, or explicitly has MAY_CERTIFY_OTHERS
  const certs = session?.user?.toolStatuses || [];
  const hasCertifierAuth = certs.some((ts: { level?: string }) => ts.level === 'MAY_CERTIFY_OTHERS');
  const isCertifier = isSysadmin || isBoardMember || hasCertifierAuth;

  if (!isCertifier && !isAdmin) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">
            Forbidden: You require the Admin, Board Member, or Certifier role to view
            this page.
          </Alert>
          <Button onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" py="md">
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap">
        <div>
          <Title order={1}>Shop Operations</Title>
          <Text c="dimmed">Centralized hub for tool management and safety certifications.</Text>
        </div>
      </Group>

      <Tabs defaultValue={isAdmin ? 'create' : isCertifier ? 'manage' : 'live'}>
        <Tabs.List>
          {isAdmin && <Tabs.Tab value="create">✨ Create Tool</Tabs.Tab>}
          {isCertifier && <Tabs.Tab value="manage">📋 Manage Tools &amp; Certifications</Tabs.Tab>}
          <Tabs.Tab value="live">📊 Live Certifications Center</Tabs.Tab>
        </Tabs.List>

        {isAdmin && (
          <Tabs.Panel value="create" pt="lg">
            <Card withBorder radius="md" padding="lg" maw={520}>
              <Text c="dimmed" mb="lg">
                Define a new piece of shop equipment to begin tracking safety certifications,
                authorizing Certifiers, and tracking usage.
              </Text>

              {createMessage && (
                <Alert color={createMessage.includes('success') ? 'green' : 'red'} mb="md">{createMessage}</Alert>
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
                  <Button type="submit" disabled={saving} loading={saving} mt="sm" style={{ alignSelf: 'flex-start' }}>
                    Create Tool
                  </Button>
                </Stack>
              </form>
            </Card>
          </Tabs.Panel>
        )}

        {isCertifier && (
          <Tabs.Panel value="manage" pt="lg">
            <Stack gap="md" align="flex-start">
              <Text c="dimmed">
                Browse all tools and safety guides, drill into certifications by tool or person, and
                grant clearance levels.
              </Text>
              <Button onClick={() => router.push('/shop/tools')}>Manage Tools &amp; Certifications</Button>
            </Stack>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="live" pt="lg">
          <Stack gap="md" align="flex-start">
            <Text c="dimmed">
              View a live matrix of participants currently at the facility and their tool
              certifications.
            </Text>
            <Button onClick={() => window.open('/kioskdisplay/certifications', '_blank')}>
              Open Live Certifications Center
            </Button>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
