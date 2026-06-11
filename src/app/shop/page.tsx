"use client";

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Card, Center, Container, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';

export default function ShopStewardPage() {
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
  const isShopSteward = session?.user?.shopSteward;
  const isAdmin = isSysadmin || isBoardMember || isShopSteward;

  // Certifier check: either Shop Steward, Board Member, Admin, or explicitly has MAY_CERTIFY_OTHERS
  const certs = session?.user?.toolStatuses || [];
  const hasCertifierAuth = certs.some((ts: { level?: string }) => ts.level === 'MAY_CERTIFY_OTHERS');
  const isCertifier = isSysadmin || isBoardMember || session?.user?.shopSteward || hasCertifierAuth;

  if (!isCertifier && !isAdmin) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">
            Forbidden: You require the Shop Steward, Admin, Board Member, or Certifier role to view
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

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {isAdmin && (
          <Card
            withBorder
            radius="md"
            padding="xl"
            onClick={() => router.push('/shop/tools/new')}
            style={{ cursor: 'pointer' }}
          >
            <Stack gap="xs">
              <Text fz={28}>✨</Text>
              <Text fw={700} fz="lg">Create Tool</Text>
              <Text c="dimmed">Register a new tool definition and safety guide into the database.</Text>
            </Stack>
          </Card>
        )}

        {isCertifier && (
          <Card
            withBorder
            radius="md"
            padding="xl"
            onClick={() => router.push('/shop/tools')}
            style={{ cursor: 'pointer' }}
          >
            <Stack gap="xs">
              <Text fz={28}>📋</Text>
              <Text fw={700} fz="lg">Manage Tools &amp; Certifications</Text>
              <Text c="dimmed">
                Browse all tools and safety guides, drill into certifications by tool or person, and
                grant clearance levels.
              </Text>
            </Stack>
          </Card>
        )}

        <Card
          withBorder
          radius="md"
          padding="xl"
          onClick={() => window.open('/kioskdisplay/certifications', '_blank')}
          style={{ cursor: 'pointer', gridColumn: '1 / -1' }}
        >
          <Stack gap="xs">
            <Text fz={28}>📊</Text>
            <Text fw={700} fz="lg">Live Certifications Center</Text>
            <Text c="dimmed">
              View a live matrix of participants currently at the facility and their tool
              certifications.
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>
    </Container>
  );
}
