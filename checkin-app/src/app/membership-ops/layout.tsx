"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";

/** Informational count for a Membership Ops nav link, or 0 when none / unknown. */
function membershipTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  return href === "/membership-ops/applications" ? counts.admin.applicationsTotal : 0;
}

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const confirmNav = useConfirmNav();
  const { data: session } = useSession();
  const sessionUser = session?.user as { sysadmin?: boolean; boardMember?: boolean } | undefined;
  const { loading, ready } = useRequireRole(["sysadmin", "boardMember"]);
  const todoCounts = useTodoCounts(!!(sessionUser?.sysadmin || sessionUser?.boardMember));

  // Total member families, shown as a gray counter on the Manage Memberships tab.
  const [memberFamilies, setMemberFamilies] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    fetch("/api/admin/households/member-count")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMemberFamilies(d.count))
      .catch(() => {});
  }, [ready]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Membership Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  // Longest-prefix match so sub-routes (e.g. /participants/123) keep their parent tab active.
  const activeTab =
    [...MEMBERSHIP_OPS_NAV_LINKS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((l) => pathname === l.href || pathname.startsWith(l.href + "/"))?.href ?? null;

  return (
    <Stack>
      <Tabs value={activeTab} onChange={(value) => { if (value && confirmNav()) router.push(value); }}>
        <ScrollableTabsList>
          {MEMBERSHIP_OPS_NAV_LINKS.map((link) => {
            const todoCount = membershipTodoCountFor(link.href, todoCounts);
            const showMemberFamilies =
              link.href === "/membership-ops/households" && memberFamilies !== null;
            return (
              <Tabs.Tab
                key={link.href}
                value={link.href}
                leftSection={<span>{link.icon}</span>}
                rightSection={
                  todoCount > 0 ? (
                    <Badge
                      size="md"
                      color="gray"
                      variant="light"
                      aria-label={`${todoCount} application${todoCount === 1 ? "" : "s"}`}
                    >
                      {todoCount}
                    </Badge>
                  ) : showMemberFamilies ? (
                    <Badge
                      size="md"
                      color="gray"
                      variant="light"
                      aria-label={`${memberFamilies} member famil${memberFamilies === 1 ? "y" : "ies"}`}
                    >
                      {memberFamilies}
                    </Badge>
                  ) : undefined
                }
              >
                {link.name}
              </Tabs.Tab>
            );
          })}
        </ScrollableTabsList>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}
