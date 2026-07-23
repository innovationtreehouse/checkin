"use client";

import { useEffect, useState } from "react";
import { Card, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { TrustedAdultContact } from "@/components/TrustedAdultContact";

interface Review {
    id: number;
    status: string;
    sharedNote: string | null;
    reviewBy: string | null;
}
interface TrustedAdult {
    id: number;
    householdId: number;
    trustedAdultName: string | null;
    trustedAdultPhone: string | null;
    trustedAdultEmail: string | null;
    household: { id: number; name: string | null } | null;
    reviews: Review[];
}

/**
 * Operational pickup list for keyholders (front desk) and program leads. Shows
 * board-approved trusted adults with the board's shared note — never the family's
 * board-facing context. Access + row scoping are enforced server-side.
 */
export default function TrustedAdultPickupPage() {
    const [items, setItems] = useState<TrustedAdult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/trusted-adults/operational")
            .then((r) => r.json())
            .then((d) => setItems(d.trustedAdults ?? []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <Center h={200}>
                <Loader />
            </Center>
        );
    }

    return (
        <Stack>
            <div>
                <Title order={2}>Trusted Adults — Pickup List</Title>
                <Text c="dimmed" size="sm">
                    Board-approved adults who may act for a household (e.g. pick up children). Showing the board&apos;s
                    shared note only.
                </Text>
            </div>

            {items.length === 0 && <Text c="dimmed">No approved trusted adults to show.</Text>}

            {items.map((ta) => {
                const latest = ta.reviews[0];
                return (
                    <Card key={ta.id} withBorder radius="md" padding="sm">
                        <Group gap="xs">
                            <Text fw={600} size="sm">{ta.trustedAdultName || "Trusted adult"}</Text>
                            <Text c="dimmed" size="sm">for {ta.household?.name || `Household ${ta.householdId}`}</Text>
                        </Group>
                        <TrustedAdultContact phone={ta.trustedAdultPhone} email={ta.trustedAdultEmail} />
                        {latest?.sharedNote && <Text size="sm" mt={4}>{latest.sharedNote}</Text>}
                        {latest?.reviewBy && (
                            <Text size="xs" c="dimmed" mt={2}>Approved through {latest.reviewBy.slice(0, 10)}</Text>
                        )}
                    </Card>
                );
            })}
        </Stack>
    );
}
