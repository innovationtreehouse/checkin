"use client";

import { Box } from "@mantine/core";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";
import { SYSTEM_STATUS_NAV_LINKS } from "@/lib/systemStatusNav";
import { useRequireRole } from "@/hooks/useRequireRole";

import { PageLoader } from "@/components/ui/PageLoader";
export default function SystemStatusLayout({ children }: { children: React.ReactNode }) {
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);

  if (loading) {
    return (
      <PageLoader />
    );
  }

  if (!ready) return null;

  return (
    <PageContainer>
      <SectionTabs links={SYSTEM_STATUS_NAV_LINKS} mb="md" />
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </PageContainer>
  );
}
