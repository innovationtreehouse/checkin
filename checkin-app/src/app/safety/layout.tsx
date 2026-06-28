"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";

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

  // Emergency Contacts is the index route; Trusted Adults is board-only.
  const tabs = [
    { name: "🚑 Emergency Contacts", href: "/safety" },
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
        <Tabs.List>
          {tabs.map((t) => (
            <Tabs.Tab key={t.href} value={t.href}>
              {t.name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}
