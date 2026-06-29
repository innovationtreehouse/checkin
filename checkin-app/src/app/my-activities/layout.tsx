"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Box, Center, Loader, Tabs } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";
import { MY_ACTIVITIES_NAV_LINKS } from "@/lib/myActivitiesNav";

export default function MyActivitiesLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const confirmNav = useConfirmNav();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (status === "unauthenticated") return null;

  // Active tab = the longest nav-link href that prefixes the current route.
  const active =
    MY_ACTIVITIES_NAV_LINKS.filter(
      (link) => pathname === link.href || pathname.startsWith(`${link.href}/`),
    ).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <>
      <Tabs
        value={active}
        onChange={(value) => {
          if (value && value !== active && confirmNav()) router.push(value);
        }}
        mb="md"
      >
        <ScrollableTabsList>
          {MY_ACTIVITIES_NAV_LINKS.map((link) => (
            <Tabs.Tab key={link.href} value={link.href} leftSection={<span>{link.icon}</span>}>
              {link.name}
            </Tabs.Tab>
          ))}
        </ScrollableTabsList>
      </Tabs>
      <Box style={{ minWidth: 0 }}>{children}</Box>
    </>
  );
}
