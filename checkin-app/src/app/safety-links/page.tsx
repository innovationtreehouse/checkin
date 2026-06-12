"use client";

import { Stack, Title } from "@mantine/core";
import SafetyLinksPanel from "@/components/SafetyLinksPanel";

export default function SafetyLinksPage() {
    return (
        <Stack p="md">
            <Title order={2}>Safety Links</Title>
            <SafetyLinksPanel />
        </Stack>
    );
}
