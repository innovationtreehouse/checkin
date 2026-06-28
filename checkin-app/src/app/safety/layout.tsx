"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";

export default function SafetyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const sessionUser = session?.user as { sysadmin?: boolean; boardMember?: boolean } | undefined;
  const isBoard = !!(sessionUser?.sysadmin || sessionUser?.boardMember);
  const { loading, ready } = useRequireRole(["sysadmin", "boardMember", "keyholder"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Safety Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  // Trusted Adults is board-only. /safety redirects to the first tab.
  const tabs = [
    { name: "🚑 Emergency Contacts", href: "/safety/emergency-contacts" },
    { name: "📞 Board Contact Info", href: "/safety/board-contacts" },
    { name: "📋 Pickup List", href: "/safety/pickup" },
    ...(isBoard ? [{ name: "🔗 Trusted Adults", href: "/safety/trusted-adults" }] : []),
  ];
  const active = tabs.find((t) => pathname === t.href)?.href ?? null;

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
          {tabs.map((t) => (
            <Tabs.Tab key={t.href} value={t.href}>
              {t.name}
            </Tabs.Tab>
          ))}
        </ScrollableTabsList>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}
