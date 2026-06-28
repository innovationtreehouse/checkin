"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";

/** Board-queue count for a Membership Ops nav link, or 0 when nothing is due / unknown. */
function membershipTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  return href === "/membership-ops/applications" ? counts.admin.membership : 0;
}

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const sessionUser = session?.user as { sysadmin?: boolean; boardMember?: boolean } | undefined;
  const { loading, ready } = useRequireRole(["sysadmin", "boardMember"]);
  const todoCounts = useTodoCounts(!!(sessionUser?.sysadmin || sessionUser?.boardMember));

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
      <Tabs value={activeTab} onChange={(value) => value && router.push(value)}>
        <ScrollableTabsList>
          {MEMBERSHIP_OPS_NAV_LINKS.map((link) => {
            const todoCount = membershipTodoCountFor(link.href, todoCounts);
            return (
              <Tabs.Tab
                key={link.href}
                value={link.href}
                leftSection={<span>{link.icon}</span>}
                rightSection={
                  todoCount > 0 ? (
                    <Badge
                      size="xs"
                      color="treehouseGreen"
                      variant="filled"
                      aria-label={`${todoCount} item${todoCount === 1 ? "" : "s"} need attention`}
                    >
                      {todoCount}
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
