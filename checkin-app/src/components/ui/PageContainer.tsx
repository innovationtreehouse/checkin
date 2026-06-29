import { Box } from "@mantine/core";

// Canonical page wrapper: same left indent + top position for every top-level
// page/tab layout, so tabs and headings don't "dance" when navigating between
// sections. The negative top margin trims a bit of the AppShell's md padding;
// paddingLeft adds a small indent past the content edge.
export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <Box style={{ maxWidth: 1200, margin: "0 auto", marginTop: -25, paddingLeft: 8, display: "flow-root" }}>
      {children}
    </Box>
  );
}
