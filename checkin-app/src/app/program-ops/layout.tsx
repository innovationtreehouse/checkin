"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { PageContainer } from "@/components/ui/PageContainer";
import { PROGRAM_NAV_LINKS } from "@/lib/programNav";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";

// A program-edit URL (/program-ops/programs/[id]) carries a PROGRAM id, so the
// layout can gate it precisely against the caller's led-program set. Session URLs
// (/program-ops/sessions/[id|new]) carry an EVENT id (or none), which the layout
// can't resolve to a program without a fetch — those keep a chrome-less admit for
// any authenticated caller and the page enforces (Event->program 403 in the API).
const programEditId = (pathname: string | null): number | null => {
  const m = pathname?.match(/^\/program-ops\/programs\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};
const isSessionFlowPath = (pathname: string | null) =>
  !!pathname?.match(/^\/program-ops\/sessions\/(\d+|new)/);

export default function ProgramOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const confirmNav = useConfirmNav();
  const { data: session, status } = useSession();

  const user = session?.user;
  const isGlobalAdmin = !!(user?.isSysadmin || user?.isBoardMember);

  // Row-aware: a lead mentor reaches program-edit only for the programs they lead.
  const editProgramId = programEditId(pathname);
  const leadsThisProgram =
    editProgramId !== null && !!user?.programsLed?.includes(editProgramId);
  const isSessionFlow = isSessionFlowPath(pathname);

  // Chrome-less (no section tabs) for the lead-mentor edit screens, as under /admin.
  const isChromeless = editProgramId !== null || isSessionFlow;
  const authorized =
    isGlobalAdmin || leadsThisProgram || (isSessionFlow && status === "authenticated");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    } else if (status === "authenticated" && !authorized) {
      router.push("/");
    }
  }, [status, authorized, router]);

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

  if (!session || !authorized) return null;

  if (isChromeless) return <>{children}</>;

  // Active tab = the longest nav href that prefixes the current route (null on the hub).
  const active =
    PROGRAM_NAV_LINKS.filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <PageContainer>
      <Tabs
        value={active}
        onChange={(value) => {
          if (value && value !== active && confirmNav()) router.push(value);
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
