"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge, Box, Center, Flex, Loader, NavLink, Paper, Stack, Text } from "@mantine/core";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";

/** Board-queue count for a Membership Ops nav link, or 0 when nothing is due / unknown. */
function membershipTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  return href === "/membership-ops/applications" ? counts.admin.membership : 0;
}

export default function MembershipOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

  return (
    <Flex gap="md" align="flex-start" wrap="wrap">
      <Paper withBorder p="xs" style={{ width: 240, flexShrink: 0 }}>
        <Text fw={800} size="lg" c="blue" px="sm" py="xs">
          Membership Ops
        </Text>
        {MEMBERSHIP_OPS_NAV_LINKS.map((link) => {
          const todoCount = membershipTodoCountFor(link.href, todoCounts);
          return (
            <NavLink
              key={link.href}
              component={Link}
              href={link.href}
              label={link.name}
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
              active={pathname === link.href}
            />
          );
        })}
      </Paper>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Flex>
  );
}
