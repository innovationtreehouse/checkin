"use client";

import { ScrollArea, Tabs } from "@mantine/core";
import type { MantineSpacing, StyleProp } from "@mantine/core";

type TabsListProps = React.ComponentProps<typeof Tabs.List>;

interface ScrollableTabsListProps extends TabsListProps {
  /** Bottom margin for the whole tab bar (applied to the scroll wrapper, not the inner list). */
  mb?: StyleProp<MantineSpacing>;
}

/**
 * Drop-in replacement for `<Tabs.List>` that scrolls horizontally on narrow
 * screens instead of wrapping into several cramped rows. On wide screens it
 * behaves exactly like a normal tab bar (no scrollbar, full-width underline).
 *
 * Use it anywhere inside `<Tabs>` where `<Tabs.List>` would go.
 */
export function ScrollableTabsList({ children, style, mb, ...props }: ScrollableTabsListProps) {
  return (
    <ScrollArea type="auto" scrollbarSize={6} mb={mb}>
      <Tabs.List style={{ flexWrap: "nowrap", ...style }} {...props}>
        {children}
      </Tabs.List>
    </ScrollArea>
  );
}
