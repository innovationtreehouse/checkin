"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Stack,
    Text,
    Textarea,
    Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

interface Review {
    id: number;
    kind: string;
    status: string;
    decision: string | null;
    decisionNote: string | null;
    conditions: string | null;
    effectiveFrom: string | null;
    reviewBy: string | null;
    createdAt: string;
}
interface PersonRef {
    id: number;
    name: string | null;
    email: string | null;
}
interface SafetyLink {
    id: number;
    counterpartyName: string | null;
    counterpartyContact: string | null;
    relationshipType: string;
    description: string;
    origin: string;
    createdAt: string;
    subject: PersonRef | null;
    counterparty: PersonRef | null;
    reviews: Review[];
}

const STATUS_COLORS: Record<string, string> = {
    PENDING_BOARD_REVIEW: "yellow",
    PENDING_SUBJECT_ACTION: "orange",
    APPROVED: "green",
    APPROVED_WITH_CONDITIONS: "teal",
    DENIED: "red",
    EXPIRED: "gray",
    REVOKED: "gray",
};
const label = (s: string) => s.replace(/_/g, " ");

export default function AdminSafetyLinksPage() {
    const [links, setLinks] = useState<SafetyLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [conditions, setConditions] = useState<Record<number, string>>({});
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/safety-links");
            if (res.ok) {
                const data = await res.json();
                setLinks(data.safetyLinks || []);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const decide = async (reviewId: number, decision: string, extra?: Record<string, unknown>) => {
        setBusyId(reviewId);
        setMessage("");
        try {
            const res = await fetch("/api/admin/safety-links/decision", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewId, decision, ...extra }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setIsError(true);
                setMessage(body.error ?? "Decision failed.");
            } else {
                setIsError(false);
                setMessage(`Recorded: ${label(body.status)}.`);
                await load();
            }
        } finally {
            setBusyId(null);
        }
    };

    const override = async (reviewId: number, action: string) => {
        setBusyId(reviewId);
        try {
            const res = await fetch("/api/admin/safety-links/override", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewId, action }),
            });
            if (res.ok) await load();
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <Center h={200}>
                <Loader />
            </Center>
        );
    }

    return (
        <Stack p="md">
            <div>
                <Title order={2}>Safety Links — Board Review</Title>
                <Text c="dimmed" size="sm">
                    Disclosed dual relationships awaiting review, awaiting the discloser, or expired. A single board
                    member&apos;s decision settles each review.
                </Text>
            </div>

            {message && (
                <Alert color={isError ? "red" : "green"} icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => setMessage("")}>
                    {message}
                </Alert>
            )}

            {links.length === 0 && <Text c="dimmed">Nothing in the queue.</Text>}

            {links.map((link) => {
                const latest = link.reviews[0];
                const status = latest?.status ?? "PENDING_BOARD_REVIEW";
                const pending = status === "PENDING_BOARD_REVIEW";
                return (
                    <Card key={link.id} withBorder radius="md" padding="md">
                        <Group justify="space-between" align="flex-start">
                            <div>
                                <Group gap="xs">
                                    <Text fw={600}>{link.subject?.name || `Participant ${link.subject?.id}`}</Text>
                                    <Text c="dimmed">→</Text>
                                    <Text>{link.counterparty?.name || link.counterpartyName || "external person"}</Text>
                                    <Badge variant="light">{label(link.relationshipType)}</Badge>
                                    <Badge color={STATUS_COLORS[status] ?? "gray"}>{label(status)}</Badge>
                                    {latest && <Badge variant="outline">{label(latest.kind)}</Badge>}
                                </Group>
                                <Text size="sm" mt={6}>{link.description}</Text>
                                {link.counterpartyContact && (
                                    <Text size="xs" c="dimmed" mt={2}>Counterparty contact: {link.counterpartyContact}</Text>
                                )}
                                {latest?.conditions && (
                                    <Text size="sm" c="teal" mt={2}>Conditions: {latest.conditions}</Text>
                                )}
                                {latest?.reviewBy && (
                                    <Text size="xs" c="dimmed" mt={2}>Review by {latest.reviewBy.slice(0, 10)}</Text>
                                )}
                                <Text size="xs" c="dimmed" mt={2}>
                                    Disclosed {link.createdAt.slice(0, 10)} · {label(link.origin)}
                                </Text>
                            </div>
                        </Group>

                        {pending && latest && (
                            <Stack mt="md" gap="xs">
                                <Group gap="xs">
                                    <Button size="xs" color="green" loading={busyId === latest.id} onClick={() => decide(latest.id, "APPROVE")}>
                                        Approve
                                    </Button>
                                    <Button size="xs" color="red" loading={busyId === latest.id} onClick={() => decide(latest.id, "DENY")}>
                                        Deny
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="light"
                                        loading={busyId === latest.id}
                                        onClick={() => {
                                            const note = window.prompt("What information do you need from the discloser?") ?? "";
                                            decide(latest.id, "REQUEST_INFO", { note });
                                        }}
                                    >
                                        Request info
                                    </Button>
                                </Group>
                                <Group gap="xs" align="flex-end">
                                    <Textarea
                                        label="Approve with conditions"
                                        placeholder="e.g. no unsupervised contact"
                                        size="xs"
                                        autosize
                                        minRows={1}
                                        style={{ flex: 1 }}
                                        value={conditions[latest.id] ?? ""}
                                        onChange={(e) => setConditions((c) => ({ ...c, [latest.id]: e.currentTarget.value }))}
                                    />
                                    <Button
                                        size="xs"
                                        color="teal"
                                        loading={busyId === latest.id}
                                        disabled={!conditions[latest.id]?.trim()}
                                        onClick={() => decide(latest.id, "APPROVE_WITH_CONDITIONS", { conditions: conditions[latest.id] })}
                                    >
                                        Approve with conditions
                                    </Button>
                                </Group>
                            </Stack>
                        )}

                        {latest && !pending && status !== "REVOKED" && (
                            <Group gap="xs" mt="md">
                                <Text size="xs" c="dimmed">Override:</Text>
                                <Button size="xs" variant="subtle" color="green" loading={busyId === latest.id} onClick={() => override(latest.id, "approve")}>
                                    Force approve
                                </Button>
                                <Button size="xs" variant="subtle" color="red" loading={busyId === latest.id} onClick={() => override(latest.id, "deny")}>
                                    Force deny
                                </Button>
                                <Button size="xs" variant="subtle" color="gray" loading={busyId === latest.id} onClick={() => override(latest.id, "revoke")}>
                                    Revoke
                                </Button>
                            </Group>
                        )}
                    </Card>
                );
            })}
        </Stack>
    );
}
