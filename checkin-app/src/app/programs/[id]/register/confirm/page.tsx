"use client";

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Center, Container, Loader, Stack, Text, Title } from '@mantine/core';

// Double opt-in, the page the confirmation email links to. We require an
// explicit click here rather than auto-confirming on load, so email link
// scanners / prefetchers don't complete the registration on the user's behalf.
export default function ConfirmRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const confirm = async () => {
        // Read the token at click time (client-only), so there's no effect/state
        // syncing the URL into React just to read it back on the next click.
        const token = new URLSearchParams(window.location.search).get("token");
        if (!token) {
            setError("No confirmation token found. Please use the link from your email.");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const res = await fetch(`/api/programs/${id}/public-register/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json();
            if (res.ok) {
                if (data.checkoutUrl) {
                    setSuccess("Confirmed! Redirecting you to checkout...");
                    window.location.href = data.checkoutUrl;
                } else {
                    setSuccess("Enrollment complete! You're all set.");
                    setTimeout(() => router.push(`/programs/${id}`), 3000);
                }
            } else {
                setError(data.error || "Failed to confirm registration.");
                setSubmitting(false);
            }
        } catch {
            setError("Network error occurred.");
            setSubmitting(false);
        }
    };

    return (
        <Container size="sm" py="xl">
            <Card withBorder radius="md" padding="xl" ta="center">
                <Stack align="center">
                    <Title order={2}>Confirm your registration</Title>
                    {success ? (
                        <Alert color="green" w="100%">{success}</Alert>
                    ) : (
                        <>
                            {error && <Alert color="red" w="100%">{error}</Alert>}
                            {submitting ? (
                                <Center><Loader /></Center>
                            ) : (
                                <>
                                    <Text c="dimmed">Click below to finish enrolling.</Text>
                                    <Button size="md" onClick={confirm}>Confirm registration</Button>
                                </>
                            )}
                        </>
                    )}
                </Stack>
            </Card>
        </Container>
    );
}
