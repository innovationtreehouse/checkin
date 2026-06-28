"use client";

import { Box, Stack, Text } from "@mantine/core";

export default function LiveCertificationsPage() {
  return (
    <Stack gap="md">
      <Text c="dimmed">
        View a live matrix of participants currently at the facility and their tool
        certifications.
      </Text>
      {/* ponytail: iframe reuses the kiosk route as-is; embedding the component
          inline fights its position:absolute inset:0 kiosk layout. mode=kiosk
          strips AppFrame chrome (see commit ed96807). */}
      <Box
        style={{
          position: "relative",
          width: "100%",
          height: "70vh",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <iframe
          src="/kioskdisplay/certifications?mode=kiosk"
          title="Live Certifications Center"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </Box>
    </Stack>
  );
}
