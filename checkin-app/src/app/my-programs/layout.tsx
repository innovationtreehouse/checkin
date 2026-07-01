"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Center, Loader, Tabs, Text, Title } from "@mantine/core";
import { PageContainer } from "@/components/ui/PageContainer";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import { useConflicts } from "@/hooks/useConflicts";
import { leadsAnyProgram, leadPendingCount } from "@/components/navBadges";

/**
 * Staff "My Programs" chrome: section title + subtabs (Attendance inbox /
 * Conflicts), gated to program lead mentors. Lead status rides in on the
 * todo-counts payload the nav already fetches — no new session field. Matches the
 * program-ops layout's route-driven Tabs pattern.
 */
export default function MyProgramsLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const authed = status === "authenticated";
  const counts = useTodoCounts(authed);
  const { conflicts } = useConflicts(authed);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
    // Authenticated but leads no program → not their home. Wait for counts (null)
    // so we don't bounce a real lead mid-fetch.
    else if (authed && counts !== null && !leadsAnyProgram(counts)) router.push("/");
  }, [status, authed, counts, router]);

  if (status === "loading" || counts === null) {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }
  if (!leadsAnyProgram(counts)) return null; // redirect in flight

  const TABS = [
    { value: "/my-programs", label: "Attendance" },
    { value: "/my-programs/conflicts", label: "Conflicts" },
  ];
  const active =
    TABS.filter((t) => pathname === t.value || pathname.startsWith(`${t.value}/`))
      .sort((a, b) => b.value.length - a.value.length)[0]?.value ?? "/my-programs";

  const pending = leadPendingCount(counts);
  const conflictCount = conflicts?.length ?? 0;

  return (
    <PageContainer>
      <Title order={1} mb="xs">My Programs</Title>
      <Text c="dimmed" mb="lg">Programs you lead, attendance waiting on you, and duplicate check-ins to resolve.</Text>
      <Tabs value={active} onChange={(v) => { if (v && v !== active) router.push(v); }} mb="md">
        <ScrollableTabsList>
          <Tabs.Tab
            value="/my-programs"
            rightSection={pending > 0 ? <Badge size="sm" circle color="treehouseGreen" c="var(--mantine-color-black)">{pending}</Badge> : undefined}
          >
            Attendance
          </Tabs.Tab>
          <Tabs.Tab
            value="/my-programs/conflicts"
            rightSection={conflictCount > 0 ? <Badge size="sm" circle color="red" c="var(--mantine-color-white)">{conflictCount}</Badge> : undefined}
          >
            Conflicts
          </Tabs.Tab>
        </ScrollableTabsList>
      </Tabs>
      {children}
    </PageContainer>
  );
}
