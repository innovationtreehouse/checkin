"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { PageContainer } from "@/components/ui/PageContainer";
import { PROGRAM_NAV_LINKS } from "@/lib/programNav";

// Program/session editing is reachable by lead mentors (program.leadMentorId, not a role flag),
// so those pages bypass the isSysadmin/isBoardMember layout gate and self-authorize.
const isProgramFlowPath = (pathname: string | null) =>
  !!(pathname?.match(/^\/program-ops\/programs\/\d+/) ||
    pathname?.match(/^\/program-ops\/sessions\/(\d+|new)/));

export default function ProgramOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const isProgramFlow = isProgramFlowPath(pathname);

  const user = session?.user;
  const isGlobalAdmin = !!(user?.isSysadmin || user?.isBoardMember);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    } else if (status === "authenticated" && !isGlobalAdmin && !isProgramFlow) {
      router.push("/");
    }
  }, [status, isGlobalAdmin, isProgramFlow, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Program Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!session || (!isGlobalAdmin && !isProgramFlow)) return null;

  // Lead-mentor editing pages render chrome-less (no section tabs), as they did under /admin.
  if (isProgramFlow) return <>{children}</>;

  // Active tab = the longest nav href that prefixes the current route (null on the hub).
  const active =
    PROGRAM_NAV_LINKS.filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <PageContainer>
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
    </PageContainer>
  );
}
