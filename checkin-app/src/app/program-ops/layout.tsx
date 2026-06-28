"use client";

import { usePathname, useRouter } from "next/navigation";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { PROGRAM_NAV_LINKS } from "@/lib/programNav";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function ProgramOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, ready } = useRequireRole(["sysadmin", "boardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Program Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  // Active tab = the longest nav href that prefixes the current route (null on the hub).
  const active =
    PROGRAM_NAV_LINKS.filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

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
          {PROGRAM_NAV_LINKS.map((link) => (
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
