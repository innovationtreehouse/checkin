"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { PageContainer } from "@/components/ui/PageContainer";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";

/** Informational count for a Membership Ops nav link, or 0 when none / unknown. */
function membershipTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  if (href === "/membership-ops/applications") return counts.admin.applicationsTotal;
  if (href === "/membership-ops/broken") return counts.admin.brokenHouseholds;
  return 0;
}

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const confirmNav = useConfirmNav();
  const { data: session } = useSession();
  const sessionUser = session?.user as { isSysadmin?: boolean; isBoardMember?: boolean } | undefined;
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);
  const todoCounts = useTodoCounts(!!(sessionUser?.isSysadmin || sessionUser?.isBoardMember));

  // Total member families, shown as a gray counter on the Manage Memberships tab.
  const memberFamilies = todoCounts?.admin?.memberFamilies ?? null;

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
    <PageContainer>
      <Stack>
      <Tabs value={activeTab} onChange={(value) => { if (value && confirmNav()) router.push(value); }}>
        <ScrollableTabsList>
          {MEMBERSHIP_OPS_NAV_LINKS.map((link) => {
            const todoCount = membershipTodoCountFor(link.href, todoCounts);
            const isBroken = link.href === "/membership-ops/broken";
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
                      color={isBroken ? "treehouseGreen" : "gray"}
                      variant={isBroken ? "filled" : "light"}
                      aria-label={isBroken ? `${todoCount} household${todoCount === 1 ? "" : "s"} without a lead` : `${todoCount} application${todoCount === 1 ? "" : "s"}`}
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
    </PageContainer>
  );
}
