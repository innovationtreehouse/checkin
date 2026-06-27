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
        <Card withBorder radius="md" padding="md">
            <Group justify="space-between" mb="sm">
                <Group gap="xs">
                    <ThemeIcon color="treehouseGreen" variant="light" radius="md">
                        <IconChecklist size={18} />
                    </ThemeIcon>
                    <Text fw={700}>Things to do</Text>
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
                    >
                        <Group justify="space-between" wrap="nowrap" gap="sm">
                            <Text size="sm">{item.label}</Text>
                            <IconChevronRight size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
                        </Group>
                    </Anchor>
                ))}
            </Stack>
        </Card>
    );
}
