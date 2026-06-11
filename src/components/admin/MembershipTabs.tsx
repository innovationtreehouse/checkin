"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@mantine/core";

export type MembershipTab = "applications" | "households" | "settings";

const TABS: { value: MembershipTab; label: string; href: string }[] = [
  { value: "applications", label: "Applications", href: "/admin/membership" },
  { value: "households", label: "Manage Memberships", href: "/admin/households" },
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
      <Tabs.List>
        {TABS.map((t) => (
          <Tabs.Tab key={t.value} value={t.value}>
            {t.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
