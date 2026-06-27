"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Box, Center, Flex, Loader, NavLink, Paper, Stack, Text } from "@mantine/core";
import { FACILITY_NAV_LINKS } from "@/lib/facilityNav";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function FacilityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, ready } = useRequireRole(["sysadmin", "boardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Facility Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  return (
    <Flex gap="md" align="flex-start" wrap="wrap">
      <Paper withBorder p="xs" style={{ width: 240, flexShrink: 0 }}>
        <Text fw={800} size="lg" c="blue" px="sm" py="xs">
          Facility Ops
        </Text>
        {FACILITY_NAV_LINKS.map((link) => (
          <NavLink
            key={link.href}
            component={Link}
            href={link.href}
            label={link.name}
            leftSection={<span>{link.icon}</span>}
            active={pathname === link.href}
          />
        ))}
      </Paper>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Flex>
  );
}
