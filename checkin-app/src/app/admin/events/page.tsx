"use client";

import { useRouter } from "next/navigation";
import { Card, SimpleGrid, Stack, Text, Title } from "@mantine/core";

export default function AdminEventsIndex() {
  const router = useRouter();

  const sections = [
    {
      title: "Visit History",
      description: "View and edit past check-in/out records.",
      link: "/facility/visits",
      icon: "🕒",
    },
    {
      title: "Live Badge Logs",
      description: "Audit real-time RFID tap events across the facility.",
      link: "/facility/badges",
      icon: "📡",
    },
    {
      title: "Create New Event",
      description: "Schedule a one-off event or manual session.",
      link: "/admin/events/new",
      icon: "➕",
    },
  ];

  return (
    <Stack>
      <div>
        <Title order={1}>Events Management</Title>
        <Text c="dimmed">
          Manage facility sessions, audit logs, and historical visit records.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {sections.map((section) => (
          <Card
            key={section.link}
            withBorder
            radius="md"
            padding="xl"
            onClick={() => router.push(section.link)}
            style={{ cursor: "pointer" }}
          >
            <Stack align="center" gap="xs" ta="center">
              <Text fz={40}>{section.icon}</Text>
              <Text fw={700} fz="lg">{section.title}</Text>
              <Text size="sm" c="dimmed">{section.description}</Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
