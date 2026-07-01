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
  const sessionUser = session?.user as { isSysadmin?: boolean; isBoardMember?: boolean; isBackgroundCheckReviewer?: boolean } | undefined;
  const isAdmin = !!(sessionUser?.isSysadmin || sessionUser?.isBoardMember);
  // Reviewers are let in so they can reach the Review tab (linked from their notifications);
  // the admin tools below stay scoped to sysadmin/board and each page 403s independently.
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember", "isBackgroundCheckReviewer"]);
  const todoCounts = useTodoCounts(isAdmin);

  // Review tab is for reviewers + board members (implicit reviewers); all other tabs
  // are admin-only. A reviewer-only user therefore sees just the Review tab.
  const canReview = !!(sessionUser?.isBackgroundCheckReviewer || sessionUser?.isBoardMember);
  const navLinks = MEMBERSHIP_OPS_NAV_LINKS.filter((l) =>
    l.href === "/membership-ops/review" ? canReview : isAdmin,
  );

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
    [...navLinks]
      .sort((a, b) => b.href.length - a.href.length)
      .find((l) => pathname === l.href || pathname.startsWith(l.href + "/"))?.href ?? null;

  return (
    <PageContainer>
      <Stack>
      <Tabs value={activeTab} onChange={(value) => { if (value && confirmNav()) router.push(value); }}>
        <ScrollableTabsList>
          {navLinks.map((link) => {
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
                      // Active tab recolors its content to the tabs color (green); pin a readable
                      // label color so the count isn't rendered green-on-green on the active tab.
                      c={isBroken ? "var(--mantine-color-black)" : "var(--mantine-color-gray-7)"}
                      aria-label={isBroken ? `${todoCount} household${todoCount === 1 ? "" : "s"} without a lead` : `${todoCount} application${todoCount === 1 ? "" : "s"}`}
                    >
                      {todoCount}
                    </Badge>
                  ) : showMemberFamilies ? (
                    <Badge
                      size="md"
                      color="gray"
                      variant="light"
                      c="var(--mantine-color-gray-7)"
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
