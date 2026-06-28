"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";

export type MembershipTab = "applications" | "households" | "settings";

const TABS: { value: MembershipTab; label: string; href: string }[] = [
  { value: "applications", label: "Applications", href: "/membership-ops/applications" },
  { value: "households", label: "Manage Memberships", href: "/membership-ops/households" },
  { value: "settings", label: "Settings", href: "/admin/membership/settings" },
];

/**
 * Shared tab bar across the membership-area admin pages, so Applications /
 * Manage Memberships / Settings read as one section. Navigates on change
 * (each tab is its own route — routes are unchanged, so existing links and
 * bookmarks keep working).
 */
export function MembershipTabs({ active }: { active: MembershipTab }) {
  const router = useRouter();
  return (
    <Tabs
      value={active}
      onChange={(value) => {
        const tab = TABS.find((t) => t.value === value);
        if (tab && value !== active) router.push(tab.href);
      }}
      mb="md"
    >
      <ScrollableTabsList>
        {TABS.map((t) => (
          <Tabs.Tab key={t.value} value={t.value}>
            {t.label}
          </Tabs.Tab>
        ))}
      </ScrollableTabsList>
    </Tabs>
  );
}
