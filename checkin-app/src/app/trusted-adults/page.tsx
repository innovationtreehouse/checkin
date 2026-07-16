"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Stack, Title } from "@mantine/core";
import TrustedAdultPanel from "@/components/TrustedAdultPanel";

import { PageLoader } from "@/components/ui/PageLoader";
export default function TrustedAdultsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    // Trusted-adult management belongs to the household lead, not dependents.
    // The API is already self-scoped; this just stops a confusing direct-URL load.
    const isLead = !!(session?.user as { householdLead?: boolean } | undefined)?.householdLead;

    useEffect(() => {
        if (status !== "loading" && !isLead) router.push("/");
    }, [status, isLead, router]);

    if (status === "loading") return <PageLoader />;
    if (!isLead) return null; // redirect in flight

    return (
        <Stack>
            <Title order={2}>Trusted Adults</Title>
            <TrustedAdultPanel />
        </Stack>
    );
}
