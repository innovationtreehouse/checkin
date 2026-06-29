"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Alert,
    Badge,
    Button,
    Card,
    Group,
    Modal,
    Stack,
    Text,
    Textarea,
    TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle, IconPlus } from "@tabler/icons-react";

const STATUS_META: Record<string, { label: string; color: string }> = {
    PENDING_BOARD_REVIEW: { label: "Awaiting board review", color: "yellow" },
    PENDING_SUBJECT_ACTION: { label: "Board needs more info", color: "orange" },
    APPROVED: { label: "Approved", color: "green" },
    DENIED: { label: "Denied", color: "red" },
    EXPIRED: { label: "Expired", color: "gray" },
    REVOKED: { label: "Withdrawn", color: "gray" },
};

interface Review {
    id: number;
    kind: string;
    status: string;
    sharedNote: string | null;
    effectiveFrom: string | null;
    reviewBy: string | null;
    createdAt: string;
}
interface TrustedAdult {
    id: number;
    counterpartyName: string | null;
    counterpartyContact: string | null;
    familyContext: string;
    createdAt: string;
    reviews: Review[];
}

const EXPIRING_SOON_DAYS = 30;

function isRenewable(status: string): boolean {
    return ["APPROVED", "EXPIRED", "DENIED", "REVOKED"].includes(status);
}

export default function TrustedAdultPanel() {
    const [items, setItems] = useState<TrustedAdult[]>([]);
    const [loading, setLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [counterpartyName, setCounterpartyName] = useState("");
    const [counterpartyContact, setCounterpartyContact] = useState("");
    const [familyContext, setFamilyContext] = useState("");

    const load = useCallback(() => {
        setLoading(true);
        fetch("/api/trusted-adults/mine")
            .then((r) => r.json())
            .then((d) => setItems(d.trustedAdults ?? []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/trusted-adults", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ counterpartyName, counterpartyContact, familyContext }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Could not submit.");
                return;
            }
            close();
            setCounterpartyName("");
            setCounterpartyContact("");
            setFamilyContext("");
            load();
        } finally {
            setSubmitting(false);
        }
    }

    async function act(id: number, action: "renew" | "withdraw") {
        const res = await fetch(`/api/trusted-adults/${id}/${action}`, { method: "POST" });
        if (res.ok) load();
        else {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? "Action failed.");
        }
    }

    const canSubmit = counterpartyName.trim() && counterpartyContact.trim() && familyContext.trim();

    return (
        <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
                <Text size="sm" c="dimmed" style={{ maxWidth: 520 }}>
                    Name an adult outside your household who the board should know about (e.g. who may pick up your
                    kids). The board reviews each one; an approval is valid for one year.
                </Text>
                <Button size="xs" fz={15} leftSection={<IconPlus size={14} />} onClick={open} style={{ flexShrink: 0 }}>
                    Add a trusted adult
                </Button>
            </Group>

            {error && (
                <Alert color="red" icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {loading && <Text c="dimmed" size="sm">Loading…</Text>}
            {!loading && items.length === 0 && (
                <Text c="dimmed" size="sm">No trusted adults added yet.</Text>
            )}

            {items.map((ta) => {
                const latest = ta.reviews[0];
                const status = latest?.status ?? "PENDING_BOARD_REVIEW";
                const meta = STATUS_META[status] ?? { label: status, color: "gray" };
                const reviewBy = latest?.reviewBy ? new Date(latest.reviewBy) : null;
                const expiringSoon =
                    reviewBy && status === "APPROVED" && reviewBy.getTime() - Date.now() < EXPIRING_SOON_DAYS * 86400000;

                return (
                    <Card key={ta.id} withBorder radius="md" padding="sm">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <div>
                                <Group gap="xs">
                                    <Text fw={600} size="sm">{ta.counterpartyName || "Trusted adult"}</Text>
                                    <Badge color={meta.color} size="sm">{meta.label}</Badge>
                                </Group>
                                {ta.counterpartyContact && (
                                    <Text size="xs" c="dimmed" mt={2}>Contact: {ta.counterpartyContact}</Text>
                                )}
                                <Text size="sm" mt={4}>{ta.familyContext}</Text>
                                {latest?.sharedNote && (
                                    <Text size="sm" mt={4} c="teal">
                                        Board note (seen by front desk & program leads): {latest.sharedNote}
                                    </Text>
                                )}
                                {reviewBy && status === "APPROVED" && (
                                    <Text size="xs" c={expiringSoon ? "orange" : "dimmed"} mt={4}>
                                        Valid until {reviewBy.toISOString().slice(0, 10)}
                                        {expiringSoon ? " — expiring soon" : ""}
                                    </Text>
                                )}
                            </div>
                            <Group gap="xs" style={{ flexShrink: 0 }}>
                                {latest && isRenewable(status) && (
                                    <Button size="xs" fz={15} variant="light" onClick={() => act(ta.id, "renew")}>
                                        Resubmit
                                    </Button>
                                )}
                                {latest && status !== "REVOKED" && (
                                    <Button size="xs" fz={15} variant="subtle" color="red" onClick={() => act(ta.id, "withdraw")}>
                                        Withdraw
                                    </Button>
                                )}
                            </Group>
                        </Group>
                    </Card>
                );
            })}

            <Modal opened={opened} onClose={close} title="Add a trusted adult" size="lg">
                <Stack>
                    <TextInput
                        label="Trusted adult's name"
                        value={counterpartyName}
                        onChange={(e) => setCounterpartyName(e.currentTarget.value)}
                        required
                    />
                    <TextInput
                        label="Their contact (phone or email)"
                        value={counterpartyContact}
                        onChange={(e) => setCounterpartyContact(e.currentTarget.value)}
                        required
                    />
                    <Textarea
                        label="For the board: what may this adult do, and any limits?"
                        description="Seen only by the board and your household — e.g. relationship, restrictions, custody notes."
                        minRows={4}
                        autosize
                        value={familyContext}
                        onChange={(e) => setFamilyContext(e.currentTarget.value)}
                        required
                    />
                    {error && <Text c="red" size="sm">{error}</Text>}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={close}>Cancel</Button>
                        <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
                            Submit for board review
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
