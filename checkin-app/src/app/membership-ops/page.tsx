"use client";

import { Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";

export default function MembershipOpsIndex() {
  const links = MEMBERSHIP_OPS_NAV_LINKS;
  return (
    <Stack>
      <div>
        <Title order={1}>Membership Ops</Title>
        <Text c="dimmed">Participant and membership management.</Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {links.map((link) => (
          <Card
            key={link.href}
            component={Link}
            href={link.href}
            withBorder
            radius="md"
            padding="md"
            style={{ textDecoration: "none" }}
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
  );
}
