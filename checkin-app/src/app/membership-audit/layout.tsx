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
];

export default function MembershipAuditLayout({ children }: { children: React.ReactNode }) {
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

  const activeTab =
    [...NAV_LINKS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((l) => pathname === l.href || pathname.startsWith(l.href + "/"))?.href ?? null;

  const missingContact = todoCounts?.admin?.householdsMissingContact ?? 0;
  const unclaimed = todoCounts?.admin?.unclaimedHouseholds ?? 0;

  return (
    <PageContainer>
      <Stack>
      <Tabs value={activeTab} onChange={(value) => value && router.push(value)}>
        <ScrollableTabsList>
          {NAV_LINKS.map((link) => {
            // Gray badges: these gaps are on the household, not something the board can fix.
            const isEmergency = link.href === "/membership-audit/emergency-contacts";
            const count = isEmergency ? missingContact : unclaimed;
            const label = isEmergency
              ? `${count} household${count === 1 ? "" : "s"} missing an emergency contact`
              : `${count} unclaimed account household${count === 1 ? "" : "s"}`;
            return (
              <Tabs.Tab
                key={link.href}
                value={link.href}
                leftSection={<span>{link.icon}</span>}
                rightSection={
                  count > 0 ? (
                    <Badge
                      size="md"
                      color="gray"
                      variant="filled"
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
