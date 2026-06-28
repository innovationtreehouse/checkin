"use client";

import { usePathname, useRouter } from "next/navigation";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { FACILITY_NAV_LINKS } from "@/lib/facilityNav";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function FacilityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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

  // Active tab = the nav link whose href matches the current route (null on the hub).
  const active = FACILITY_NAV_LINKS.find((link) => pathname === link.href)?.href ?? null;

  return (
    <>
      <Tabs
        value={active}
        onChange={(value) => {
          if (value && value !== active) router.push(value);
        }}
        mb="md"
      >
        <ScrollableTabsList>
          {FACILITY_NAV_LINKS.map((link) => (
            <Tabs.Tab key={link.href} value={link.href} leftSection={<span>{link.icon}</span>}>
              {link.name}
            </Tabs.Tab>
          ))}
        </ScrollableTabsList>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}
