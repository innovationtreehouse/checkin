"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Tabs } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";

export type SettingsTab = "membership" | "roles" | "localization";

// sysadminOnly tabs are hidden from board members (the /settings layout admits both).
const TABS: { value: SettingsTab; label: string; href: string; sysadminOnly?: boolean }[] = [
  { value: "membership", label: "Membership Settings", href: "/settings/membership" },
  { value: "roles", label: "Role Assignment", href: "/settings/roles" },
  { value: "localization", label: "Localization", href: "/settings/localization", sysadminOnly: true },
];

/**
 * Shared tab bar across the Settings-area pages, so Membership Settings and
 * Role Assignment read as one section. Navigates on change (each tab is its own
 * route).
 */
export function SettingsTabs({ active }: { active: SettingsTab }) {
  const router = useRouter();
  const confirmNav = useConfirmNav();
  const { data: session } = useSession();
  const isSysadmin = !!session?.user?.sysadmin;
  const tabs = TABS.filter((t) => !t.sysadminOnly || isSysadmin);
  return (
    <Tabs
      value={active}
      onChange={(value) => {
        const tab = tabs.find((t) => t.value === value);
        if (tab && value !== active) {
          if (!confirmNav()) return;
          router.push(tab.href);
        }
      }}
      mb="md"
    >
      <ScrollableTabsList>
        {tabs.map((t) => (
          <Tabs.Tab key={t.value} value={t.value}>
            {t.label}
          </Tabs.Tab>
        ))}
      </ScrollableTabsList>
    </Tabs>
  );
}
