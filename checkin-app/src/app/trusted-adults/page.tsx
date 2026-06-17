"use client";

import { Stack, Title } from "@mantine/core";
import TrustedAdultPanel from "@/components/TrustedAdultPanel";

export default function TrustedAdultsPage() {
    return (
        <Stack p="md">
            <Title order={2}>Trusted Adults</Title>
            <TrustedAdultPanel />
        </Stack>
    );
}
