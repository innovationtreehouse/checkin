"use client";

import { Stack, Text } from "@mantine/core";
import { ToolManagementPanel } from "./ToolManagementPanel";

export default function ManageToolsPage() {
  return (
    <Stack gap="md">
      <Text c="dimmed">
        Browse all tools and safety guides, drill into certifications by tool or person, and
        grant clearance levels.
      </Text>
      <ToolManagementPanel />
    </Stack>
  );
}
