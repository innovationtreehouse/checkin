"use client";

import { useSession } from "next-auth/react";
import { Badge, Box, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import { tabBadgeFor, reviewBadges } from "@/components/navBadges";
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
      return (
        <Group gap={4} wrap="nowrap">
          {badges.map((b) => {
            const isGray = b.color === "gray";
            return (
              <Badge
                key={b.color}
                size="md"
                color={isGray ? "gray" : b.color}
                variant={isGray ? "light" : "filled"}
                // Dark text: black on the green fill (matches other green count
                // circles), gray-7 on the light-gray bubble. Also survives the
                // active tab's green recolor.
                c={isGray ? "var(--mantine-color-gray-7)" : "var(--mantine-color-black)"}
                aria-label={b.label}
              >
                {b.count}
              </Badge>
            );
          })}
        </Group>
      );
    }
    const badge = tabBadgeFor(href, todoCounts);
    if (badge) {
      return (
        <Badge
          size="md"
          color="gray.2"
          variant="filled"
          // Active tab recolors its content to the tabs color (green); pin a readable
          // label color so the count isn't rendered green-on-green on the active tab.
          // gray.2 filled + gray-8 text (matches the membership-audit tab badges) for
          // legible contrast — the light tint read too faint.
          c="var(--mantine-color-gray-8)"
          aria-label={badge.label}
        >
          {badge.count}
        </Badge>
      );
    }
    if (href === "/membership-ops/households" && memberFamilies !== null) {
      return (
        <Badge
          size="md"
          // Gray total counter, matching the other gray tab badges: gray.2 fill +
          // gray-8 text (pinned so it survives the active tab's green recolor).
          color="gray.2"
          variant="filled"
          c="var(--mantine-color-gray-8)"
          aria-label={`${memberFamilies} org member famil${memberFamilies === 1 ? "y" : "ies"}`}
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
