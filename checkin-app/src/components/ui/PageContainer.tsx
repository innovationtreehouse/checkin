import { Box } from "@mantine/core";

// Canonical page wrapper: same left indent + top position for every top-level
// page/tab layout, so tabs and headings don't "dance" when navigating between
// sections. The negative top margin trims part of the AppShell's md padding
// (16px) for a tighter look — must stay smaller than it, or content slides up
// behind the fixed 60px header (z-index 200) and its top gets clipped, which is
// exactly what a -25 overshoot did to the ops tab bars. paddingLeft adds a small
// indent past the content edge.
export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <Box style={{ maxWidth: 1200, margin: "0 auto", marginTop: -8, paddingLeft: 8, display: "flow-root" }}>
      {children}
    </Box>
  );
}
