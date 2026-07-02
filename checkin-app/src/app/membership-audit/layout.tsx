"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Box, Center, Loader, Stack, Tabs, Text } from "@mantine/core";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { PageContainer } from "@/components/ui/PageContainer";

const NAV_LINKS = [
  { name: "Emergency Contacts", href: "/membership-audit/emergency-contacts", icon: "🚑" },
  { name: "Unclaimed Accounts", href: "/membership-audit/unclaimed", icon: "📨" },
  { name: "Broken Households", href: "/membership-audit/broken", icon: "⚠️" },
];

export default function MembershipAuditLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const sessionUser = session?.user as { isSysadmin?: boolean; isBoardMember?: boolean } | undefined;
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);
  const todoCounts = useTodoCounts(!!(sessionUser?.isSysadmin || sessionUser?.isBoardMember));

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

  const activeTab =
    [...NAV_LINKS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((l) => pathname === l.href || pathname.startsWith(l.href + "/"))?.href ?? null;

  const missingContact = todoCounts?.admin?.householdsMissingContact ?? 0;
  const unclaimed = todoCounts?.admin?.unclaimedHouseholds ?? 0;
  const broken = todoCounts?.admin?.brokenHouseholds ?? 0;

  // Emergency/Unclaimed are gray: gaps on the household, not something the board can fix.
  // Broken is green: the board must assign a lead. Returns [count, label].
  const badgeFor = (href: string): [number, string] => {
    if (href === "/membership-audit/emergency-contacts")
      return [missingContact, `${missingContact} household${missingContact === 1 ? "" : "s"} missing an emergency contact`];
    if (href === "/membership-audit/broken")
      return [broken, `${broken} household${broken === 1 ? "" : "s"} without a lead`];
    return [unclaimed, `${unclaimed} unclaimed account household${unclaimed === 1 ? "" : "s"}`];
  };

  return (
    <PageContainer>
      <Stack>
      <Tabs value={activeTab} onChange={(value) => value && router.push(value)}>
        <ScrollableTabsList>
          {NAV_LINKS.map((link) => {
            const [count, label] = badgeFor(link.href);
            const isBroken = link.href === "/membership-audit/broken";
            return (
              <Tabs.Tab
                key={link.href}
                value={link.href}
                leftSection={<span>{link.icon}</span>}
                rightSection={
                  count > 0 ? (
                    <Badge
                      size="md"
                      color={isBroken ? "treehouseGreen" : "gray"}
                      variant={isBroken ? "filled" : "light"}
                      // Pinned label color so the active tab's green recolor doesn't render the
                      // count green-on-green (gray informational fill, or black on the green fill).
                      c={isBroken ? "var(--mantine-color-black)" : "var(--mantine-color-gray-7)"}
                      aria-label={label}
                    >
                      {count}
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
