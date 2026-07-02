"use client";

import { Box, Center, Loader, Stack, Text } from "@mantine/core";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";
import { FINANCE_NAV_LINKS } from "@/lib/financeNav";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function FinanceOpsLayout({ children }: { children: React.ReactNode }) {
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Finance Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  return (
    <PageContainer>
      <SectionTabs links={FINANCE_NAV_LINKS} mb="md" />
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </PageContainer>
  );
}
