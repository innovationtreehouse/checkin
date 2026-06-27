"use client";

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Card, Center, Container, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';

export default function ShopOpsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

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
        <Button component={Link} href="/dashboard" variant="default">
          ← Main Dashboard
        </Button>
      </Group>

      <Tabs defaultValue={isAdmin ? 'create' : isCertifier ? 'manage' : 'live'}>
        <Tabs.List>
          {isAdmin && <Tabs.Tab value="create">✨ Create Tool</Tabs.Tab>}
          {isCertifier && <Tabs.Tab value="manage">📋 Manage Tools &amp; Certifications</Tabs.Tab>}
          <Tabs.Tab value="live">📊 Live Certifications Center</Tabs.Tab>
        </Tabs.List>

        {isAdmin && (
          <Tabs.Panel value="create" pt="lg">
            <Stack gap="md" align="flex-start">
              <Text c="dimmed">Register a new tool definition and safety guide into the database.</Text>
              <Button onClick={() => router.push('/shop/tools/new')}>Create Tool</Button>
            </Stack>
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
