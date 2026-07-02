"use client";

import { useSession } from "next-auth/react";
import { Badge, Box, Center, Loader, Stack, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";

/** Informational count for a Membership Ops nav link, or 0 when none / unknown. */
function membershipTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  if (href === "/membership-ops/applications") return counts.admin.applicationsTotal;
  return 0;
}

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
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

  // Right-aligned count badge for a tab: pending applications, or the member-family total.
  const badgeFor = (href: string): React.ReactNode => {
    const todoCount = membershipTodoCountFor(href, todoCounts);
    if (todoCount > 0) {
      return (
        <Badge
          size="md"
          color="gray"
          variant="light"
          // Active tab recolors its content to the tabs color (green); pin a readable
          // label color so the count isn't rendered green-on-green on the active tab.
          c="var(--mantine-color-gray-7)"
          aria-label={`${todoCount} application${todoCount === 1 ? "" : "s"}`}
        >
          {todoCount}
        </Badge>
      );
    }
    if (href === "/membership-ops/households" && memberFamilies !== null) {
      return (
        <Badge
          size="md"
          // Dark-gray total counter: gray.8 is dark enough for white text (plain
          // gray filled = gray.6 ≈ #868e96, where white fails contrast). Pinned white
          // also survives the active tab's green recolor.
          color="gray.8"
          variant="filled"
          c="white"
          aria-label={`${memberFamilies} member famil${memberFamilies === 1 ? "y" : "ies"}`}
        >
          {memberFamilies}
        </Badge>
      );
    }
    return undefined;
  };

  return (
    <PageContainer>
      <Stack>
        <SectionTabs links={navLinks} prefixMatch badgeFor={badgeFor} />
        <Box style={{ minWidth: 0 }}>{children}</Box>
      </Stack>
    </PageContainer>
  );
}
