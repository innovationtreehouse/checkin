"use client";

import { usePathname, useRouter } from "next/navigation";
import { Box, Center, Loader, Tabs } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { SYSTEM_STATUS_NAV_LINKS } from "@/lib/systemStatusNav";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function SystemStatusLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, ready } = useRequireRole(["sysadmin", "boardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (!ready) return null;

  const links = SYSTEM_STATUS_NAV_LINKS.filter((link) => !link.sysadminOnly || user?.sysadmin);
  // Active tab = the nav link whose href matches the current route (null on the hub).
  const active = links.find((link) => pathname === link.href)?.href ?? null;

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
          {links.map((link) => (
            <Tabs.Tab key={link.href} value={link.href}>
              {link.name}
            </Tabs.Tab>
          ))}
        </ScrollableTabsList>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}
