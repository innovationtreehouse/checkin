"use client";

import { Box, Center, Loader } from "@mantine/core";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";
import { SYSTEM_STATUS_NAV_LINKS } from "@/lib/systemStatusNav";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function SystemStatusLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (!ready) return null;

  const links = SYSTEM_STATUS_NAV_LINKS.filter((link) => !link.sysadminOnly || user?.isSysadmin);

  return (
    <PageContainer>
      <SectionTabs links={links} mb="md" />
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </PageContainer>
  );
}
