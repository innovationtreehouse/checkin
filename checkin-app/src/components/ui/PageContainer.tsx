import { Box } from "@mantine/core";

// Canonical page wrapper: same left indent + top position for every top-level
// page/tab layout, so tabs and headings don't "dance" when navigating between
// sections. No top margin: the full AppShell md padding (16px) stands, so tab
// bars get real breathing room under the fixed 60px header (z-index 200)
// instead of rendering flush against it. Do not push this negative again — a
// -25 overshoot once did exactly that, sliding content up behind the header
// and clipping the ops tab bars (fixed by #1007); a negative value here must
// never exceed the AppShell's md padding. paddingLeft adds a small indent past
// the content edge.
export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <Box style={{ maxWidth: 1200, margin: "0 auto", marginTop: 0, paddingLeft: 8, display: "flow-root" }}>
      {children}
    </Box>
  );
}
