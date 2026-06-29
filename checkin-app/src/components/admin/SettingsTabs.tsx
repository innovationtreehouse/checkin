"use client";

import { useRouter } from "next/navigation";
import { Tabs } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";

export type SettingsTab = "membership" | "roles";

const TABS: { value: SettingsTab; label: string; href: string }[] = [
  { value: "membership", label: "Membership Settings", href: "/settings/membership" },
  { value: "roles", label: "Role Assignment", href: "/settings/roles" },
];

/**
 * Shared tab bar across the Settings-area pages, so Membership Settings and
 * Role Assignment read as one section. Navigates on change (each tab is its own
 * route).
 */
export function SettingsTabs({ active }: { active: SettingsTab }) {
  const router = useRouter();
  const confirmNav = useConfirmNav();
  return (
    <Tabs
      value={active}
      onChange={(value) => {
        const tab = TABS.find((t) => t.value === value);
        if (tab && value !== active) {
          if (!confirmNav()) return;
          router.push(tab.href);
        }
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
