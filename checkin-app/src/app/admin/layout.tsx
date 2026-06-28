"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Box, Center, Flex, Loader, NavLink, Paper, Stack, Text } from "@mantine/core";
import { ADMIN_NAV_SECTIONS } from "@/lib/adminNav";

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
      } else if (user?.keyholder && !user?.sysadmin && !user?.boardMember && !isProgramFlow) {
        // Keyholders have no admin pages anymore; their emergency-contacts view lives under Safety.
        router.push("/safety");
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

  return (
    <Flex
      gap="md"
      direction={{ base: "column", sm: "row" }}
      align={{ base: "stretch", sm: "flex-start" }}
    >
      <Paper withBorder p="xs" w={{ base: "100%", sm: 240 }} style={{ flexShrink: 0 }}>
        <Text fw={800} size="lg" c="blue" px="sm" py="xs">
          Admin Ops
        </Text>
        {ADMIN_NAV_SECTIONS.map((section) => (
          <Box key={section.title} mb="sm">
            <Text size="xs" tt="uppercase" c="dimmed" fw={600} px="sm" mb={4}>
              {section.title}
            </Text>
            {section.links.map((link) => (
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
        ))}
      </Paper>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Flex>
  );
}
