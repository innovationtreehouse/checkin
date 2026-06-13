"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Badge, Box, Center, Flex, Loader, NavLink, Paper, Stack, Text } from "@mantine/core";
import { ADMIN_NAV_SECTIONS } from "@/lib/adminNav";
import { useTodoCounts } from "@/hooks/useTodoCounts";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";

type AdminUser = { sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean };

/** Board-queue count for an admin nav link, or 0 when nothing is due / unknown. */
function adminTodoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts?.admin) return 0;
  switch (href) {
    case "/admin/membership":
      return counts.admin.membership;
    case "/admin/programs/pending":
      return counts.admin.programsPending;
    case "/admin/safety-links":
      return counts.admin.safetyLinks;
    default:
      return 0;
  }
}

// Program/event editing flow is reachable by program leads, so it bypasses the general admin gate.
const isProgramFlowPath = (pathname: string | null) =>
  !!(pathname?.startsWith("/admin/programs") || pathname?.match(/^\/admin\/events\/(\d+|new)/));

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const router = useRouter();
  const sessionUser = session?.user as AdminUser | undefined;
  // Called before any early return so hook order stays stable (rules of hooks).
  // Admin counts are only returned for board/sysadmin, so gate the fetch on that.
  const todoCounts = useTodoCounts(!!(sessionUser?.sysadmin || sessionUser?.boardMember));

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    } else if (status === "authenticated") {
      const user = session?.user as AdminUser;
      const isAuthorizedGlobalAdmin = user?.sysadmin || user?.boardMember || user?.keyholder;
      const isProgramFlow = isProgramFlowPath(pathname);

      if (!isAuthorizedGlobalAdmin && !isProgramFlow) {
        // Basic participants are NOT allowed in general admin areas
        router.push("/");
      } else if (user?.keyholder && !user?.sysadmin && !user?.boardMember && pathname !== "/admin/emergency-contacts" && !isProgramFlow) {
        // Keyholders who try to access other admin pages get sent to emergency contacts (unless they are doing program stuff)
        router.push("/admin/emergency-contacts");
      }
    }
  }, [status, session, router, pathname]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Admin Access...</Text>
        </Stack>
      </Center>
    );
  }

  const user = session?.user as AdminUser;
  const isProgramFlow = isProgramFlowPath(pathname);

  if (!session || (!user?.sysadmin && !user?.boardMember && !user?.keyholder && !isProgramFlow)) {
    return null;
  }

  if (isProgramFlow) {
    return <>{children}</>;
  }

  const isStrictKeyholder = user?.keyholder && !user?.sysadmin && !user?.boardMember;

  return (
    <Flex gap="md" align="flex-start" wrap="wrap">
      <Paper withBorder p="xs" style={{ width: 240, flexShrink: 0 }}>
        <Text fw={800} size="lg" c="blue" px="sm" py="xs">
          Admin Ops
        </Text>
        {ADMIN_NAV_SECTIONS.map((section) => {
          const filteredLinks = isStrictKeyholder
            ? section.links.filter((link) => link.href === '/admin/emergency-contacts')
            : section.links;

          if (filteredLinks.length === 0) return null;

          return (
            <Box key={section.title} mb="sm">
              <Text size="xs" tt="uppercase" c="dimmed" fw={600} px="sm" mb={4}>
                {section.title}
              </Text>
              {filteredLinks.map((link) => {
                const todoCount = adminTodoCountFor(link.href, todoCounts);
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
            </Box>
          );
        })}
      </Paper>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Flex>
  );
}
