"use client";

import Link from "next/link";
import { Card, Group, Stack, Text, ThemeIcon, Badge, Anchor } from "@mantine/core";
import { IconChecklist, IconChevronRight } from "@tabler/icons-react";
import { useTodoCounts } from "@/hooks/useTodoCounts";

/**
 * "Things to do" — the member's open todo items, each with a direct link to the
 * page that resolves it. The nav badges show *how many*; this card shows *what*,
 * so a count never dead-ends. Renders nothing when there is nothing to do.
 *
 * Fed by the same /api/nav/todo-counts source as the nav badges, so it updates
 * live on the nav-counts-mutated event.
 */
export default function TodoCard() {
    const counts = useTodoCounts(true);
    if (!counts) return null;

    const items = [...counts.member.household, ...counts.member.programs];
    if (items.length === 0) return null;

    return (
        <Card withBorder radius="lg" padding="xl" bg="yellow.2" c="black" style={{ borderColor: "var(--mantine-color-yellow-5)", borderWidth: 2 }}>
            <Group justify="space-between" mb="sm">
                <Group gap="xs">
                    <ThemeIcon color="dark" variant="filled" radius="xl">
                        <IconChecklist size={18} />
                    </ThemeIcon>
                    <Text fw={700} c="black">Things to do</Text>
                </Group>
                <Badge color="treehouseGreen" variant="filled">
                    {items.length}
                </Badge>
            </Group>
            <Stack gap="xs">
                {items.map((item) => (
                    <Anchor
                        key={item.key}
                        component={Link}
                        href={item.href}
                        underline="never"
                        c="inherit"
                        onClick={(e) => {
                            // Same-page hash link: if the URL is already at that hash,
                            // Next/the browser fires no navigation, so the second click
                            // wouldn't scroll. Scroll the target ourselves when it's
                            // already in the DOM (cross-page links fall through to Link).
                            const hash = item.href.split("#")[1];
                            const el = hash && document.getElementById(hash);
                            if (el) {
                                e.preventDefault();
                                el.scrollIntoView({ behavior: "smooth" });
                            }
                        }}
                    >
                        <Group justify="space-between" wrap="nowrap" gap="sm">
                            <Text size="sm" c="black">{item.label}</Text>
                            <IconChevronRight size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
                        </Group>
                    </Anchor>
                ))}
            </Stack>
        </Card>
    );
}
