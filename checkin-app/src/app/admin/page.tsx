"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Alert, Card, Group, List, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import Link from "next/link";
import { ADMIN_NAV_SECTIONS } from "@/lib/adminNav";

type Orphan = { id: number; name?: string | null; email?: string | null };

export default function AdminDashboardIndex() {
  const { data: session } = useSession();
  const [orphans, setOrphans] = useState<Orphan[]>([]);

  useEffect(() => {
    fetch('/api/admin/orphans')
      .then(res => res.json())
      .then(data => {
        if (data.orphans) {
          setOrphans(data.orphans);
        }
      })
      .catch(console.error);
  }, []);

  return (
    <Stack>
      <div>
        <Title order={1}>Admin Dashboard</Title>
        <Text c="dimmed">
          Welcome back, {session?.user?.name || 'Admin'}. Here is an overview of the facility
          status and pending tasks.
        </Text>
      </div>

      {orphans.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Attention Required">
          <Text mb="sm">
            There are {orphans.length} student(s) registered whose parents have not yet claimed
            their accounts. These students cannot be tracked correctly until their households are
            linked.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
            {orphans.map((o) => (
              <Text key={o.id} fw={500} size="sm">
                {o.name || o.email || `Student ID ${o.id}`}
              </Text>
            ))}
          </SimpleGrid>
        </Alert>
      )}

      {ADMIN_NAV_SECTIONS.filter((s) => s.title !== 'Dashboard').map((section) => (
        <Stack key={section.title} gap="xs">
          <Title order={4}>{section.title}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {section.links.map((link) => (
              <Card
                key={link.href}
                component={Link}
                href={link.href}
                withBorder
                radius="md"
                padding="md"
                style={{ textDecoration: 'none' }}
              >
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Text fz={22} component="span">{link.icon}</Text>
                  <div>
                    <Text fw={600} c="var(--mantine-color-text)">{link.name}</Text>
                    {link.description && <Text size="xs" c="dimmed">{link.description}</Text>}
                  </div>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      ))}

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder radius="md" padding="lg">
          <Title order={4} mb="md">Quick Stats</Title>
          <SimpleGrid cols={2}>
            <Card withBorder radius="sm" padding="sm" ta="center">
              <Text fz="xl" fw={800}>--</Text>
              <Text size="xs" c="dimmed" tt="uppercase">Active Guests</Text>
            </Card>
            <Card withBorder radius="sm" padding="sm" ta="center">
              <Text fz="xl" fw={800}>--</Text>
              <Text size="xs" c="dimmed" tt="uppercase">Check-ins Today</Text>
            </Card>
          </SimpleGrid>
          <Text size="sm" c="dimmed" mt="md">
            Real-time stats are coming soon in the next update.
          </Text>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Title order={4} mb="md">System Health</Title>
          <List spacing="xs" listStyleType="none">
            <List.Item>
              <Group justify="space-between">
                <span>Database</span>
                <Text c="green">● Operational</Text>
              </Group>
            </List.Item>
            <List.Item>
              <Group justify="space-between">
                <span>RFID Gateway</span>
                <Text c="green">● Connected</Text>
              </Group>
            </List.Item>
            <List.Item>
              <Group justify="space-between">
                <span>Last Backup</span>
                <Text c="dimmed">2 hours ago</Text>
              </Group>
            </List.Item>
          </List>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
