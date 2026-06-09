"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Box, Center, Flex, Loader, NavLink, Paper, Stack, Text } from "@mantine/core";

type AdminUser = { sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean };

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

  const navItems = [
    {
      title: "Dashboard",
      links: [{ name: "Dashboard", href: "/admin", icon: "📊" }],
    },
    {
      title: "Operations",
      links: [
        { name: "Visit History", href: "/admin/events/visits", icon: "🕒" },
        { name: "Raw Badge Events", href: "/admin/events/badges", icon: "📡" },
        { name: "Print ID Badges", href: "/admin/print-badges", icon: "🖨️" },
        { name: "Participation Trends", href: "/admin/trends", icon: "📈" },
        { name: "System Health", href: "/admin/systemhealth", icon: "🫀" },
      ],
    },
    {
      title: "People",
      links: [
        { name: "Participants", href: "/admin/participants", icon: "👥" },
        { name: "Merge Participants", href: "/admin/participants/merge", icon: "🔗" },
        { name: "Manage Memberships", href: "/admin/households", icon: "🏠" },
        { name: "Membership Applications", href: "/admin/membership", icon: "📋" },
        { name: "Membership Settings", href: "/admin/membership/settings", icon: "⚙️" },
        { name: "Pending Participants", href: "/admin/programs/pending", icon: "⏳" },
        { name: "Emergency Contacts", href: "/admin/emergency-contacts", icon: "🚑" },
        { name: "Role Assignment", href: "/admin/roles", icon: "🔐" },
      ],
    },
  ];

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
        {navItems.map((section) => {
          const filteredLinks = isStrictKeyholder
            ? section.links.filter((link) => link.href === '/admin/emergency-contacts')
            : section.links;

          if (filteredLinks.length === 0) return null;

          return (
            <Box key={section.title} mb="sm">
              <Text size="xs" tt="uppercase" c="dimmed" fw={600} px="sm" mb={4}>
                {section.title}
              </Text>
              {filteredLinks.map((link) => (
                <NavLink
                  key={link.href}
                  component={Link}
                  href={link.href}
                  label={link.name}
                  leftSection={<span>{link.icon}</span>}
                  active={pathname === link.href}
                />
              ))}
            </Box>
          );
        })}
      </Paper>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Flex>
  );
}
