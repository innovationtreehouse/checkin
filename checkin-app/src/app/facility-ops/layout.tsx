"use client";

import { Box, Center, Loader, Stack, Text } from "@mantine/core";
import { FACILITY_NAV_LINKS } from "@/lib/facilityNav";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { PageContainer } from "@/components/ui/PageContainer";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function FacilityLayout({ children }: { children: React.ReactNode }) {
  const { loading, ready } = useRequireRole(["isSysadmin", "isBoardMember"]);

  if (loading) {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying Facility Access...</Text>
        </Stack>
      </Center>
    );
  }

  if (!ready) return null;

  return (
    <PageContainer>
      <SectionTabs links={FACILITY_NAV_LINKS} mb="md" />
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </PageContainer>
  );
}
