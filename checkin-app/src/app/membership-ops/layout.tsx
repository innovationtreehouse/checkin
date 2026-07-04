"use client";

import { useSession } from "next-auth/react";
import { Box, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import { tabBadgeFor, reviewBadges } from "@/components/navBadges";
import { CountBadge } from "@/components/ui/CountBadge";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const sessionUser = session?.user as { isSysadmin?: boolean; isBoardMember?: boolean; isBackgroundCheckReviewer?: boolean } | undefined;
  const isAdmin = !!(sessionUser?.isSysadmin || sessionUser?.isBoardMember);
  // Reviewers are let in so they can reach the Review tab (linked from their notifications);
  // the admin tools below stay scoped to sysadmin/board and each page 403s independently.
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember", "isBackgroundCheckReviewer"]);

  // Review tab is for reviewers + board members (implicit reviewers); all other tabs
  // are admin-only. A reviewer-only user therefore sees just the Review tab.
  const canReview = !!(sessionUser?.isBackgroundCheckReviewer || sessionUser?.isBoardMember);
  // Fetch counts for reviewers too (not just admins), so the Review tab badges
  // work for a reviewer-only user.
  const todoCounts = useTodoCounts(isAdmin || canReview);
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
    // Review tab shows two viewer-scoped badges: green (can act on now), gray
    // (approved, awaiting a second reviewer). Colors match the left-nav badges.
    if (href === "/membership-ops/review") {
      const badges = reviewBadges(todoCounts);
      if (badges.length === 0) return undefined;
      // Same mapping as the left-nav (AppFrame): green = action, gray = info,
      // both through the shared CountBadge so the tab count matches everywhere.
      return (
        <Group gap={4} wrap="nowrap">
          {badges.map((b) => (
            <CountBadge key={b.color} intent={b.color === "gray" ? "info" : "action"} aria-label={b.label}>
              {b.count}
            </CountBadge>
          ))}
        </Group>
      );
    }
    const badge = tabBadgeFor(href, todoCounts);
    if (badge) {
      return (
        <CountBadge intent="info" aria-label={badge.label}>
          {badge.count}
        </CountBadge>
      );
    }
    if (href === "/membership-ops/households" && memberFamilies !== null) {
      return (
        <CountBadge
          intent="info"
          aria-label={`${memberFamilies} org member famil${memberFamilies === 1 ? "y" : "ies"}`}
        >
          {memberFamilies}
        </CountBadge>
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
