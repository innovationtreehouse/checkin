"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Alert,
    Badge,
    Button,
    Card,
    Group,
    Modal,
    Select,
    Stack,
    Text,
    Textarea,
    TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle, IconPlus } from "@tabler/icons-react";

const RELATIONSHIP_TYPES = [
    { value: "FAMILY", label: "Family" },
    { value: "GUARDIAN", label: "Guardian" },
    { value: "HOUSEHOLD", label: "Household" },
    { value: "ROMANTIC", label: "Romantic partner" },
    { value: "FORMER_PROFESSIONAL", label: "Former professional (e.g. care provider)" },
    { value: "FINANCIAL", label: "Financial" },
    { value: "LEGAL_RESTRICTION", label: "Legal restriction (e.g. court order)" },
    { value: "OTHER", label: "Other" },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
    PENDING_BOARD_REVIEW: { label: "Awaiting board review", color: "yellow" },
    PENDING_SUBJECT_ACTION: { label: "Board needs more info", color: "orange" },
    APPROVED: { label: "Approved", color: "green" },
    APPROVED_WITH_CONDITIONS: { label: "Approved with conditions", color: "teal" },
    DENIED: { label: "Denied", color: "red" },
    EXPIRED: { label: "Expired", color: "gray" },
    REVOKED: { label: "Withdrawn", color: "gray" },
};

interface Review {
    id: number;
    kind: string;
    status: string;
    conditions: string | null;
    effectiveFrom: string | null;
    reviewBy: string | null;
    createdAt: string;
}
interface SafetyLink {
    id: number;
    counterpartyName: string | null;
    counterpartyContact: string | null;
    relationshipType: string;
    description: string;
    createdAt: string;
    reviews: Review[];
}

const EXPIRING_SOON_DAYS = 30;

function isRenewable(status: string): boolean {
    return ["APPROVED", "APPROVED_WITH_CONDITIONS", "EXPIRED", "DENIED", "REVOKED"].includes(status);
}

export default function SafetyLinksPanel() {
    const [links, setLinks] = useState<SafetyLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [opened, { open, close }] = useDisclosure(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [relationshipType, setRelationshipType] = useState<string | null>(null);
    const [counterpartyName, setCounterpartyName] = useState("");
    const [counterpartyContact, setCounterpartyContact] = useState("");
    const [description, setDescription] = useState("");

    const load = useCallback(() => {
        setLoading(true);
        fetch("/api/safety-links/mine")
            .then((r) => r.json())
            .then((d) => setLinks(d.safetyLinks ?? []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/safety-links", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipType, counterpartyName, counterpartyContact, description }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Could not submit.");
                return;
            }
            close();
            setRelationshipType(null);
            setCounterpartyName("");
            setCounterpartyContact("");
            setDescription("");
            load();
        } finally {
            setSubmitting(false);
        }
    }

    async function act(id: number, action: "renew" | "withdraw") {
        const res = await fetch(`/api/safety-links/${id}/${action}`, { method: "POST" });
        if (res.ok) load();
        else {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? "Action failed.");
        }
    }

    return (
        <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
                <Text size="sm" c="dimmed" style={{ maxWidth: 520 }}>
                    Disclose a board-approved relationship (family, guardian, legal restriction, etc.) tied to a member
                    of this household. Each disclosure is reviewed by the board and valid for one year.
                </Text>
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={open} style={{ flexShrink: 0 }}>
                    Disclose a relationship
                </Button>
            </Group>

            {error && (
                <Alert color="red" icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {loading && <Text c="dimmed" size="sm">Loading…</Text>}
            {!loading && links.length === 0 && (
                <Text c="dimmed" size="sm">No relationships disclosed yet.</Text>
            )}

            {links.map((link) => {
                const latest = link.reviews[0];
                const status = latest?.status ?? "PENDING_BOARD_REVIEW";
                const meta = STATUS_META[status] ?? { label: status, color: "gray" };
                const relLabel = RELATIONSHIP_TYPES.find((r) => r.value === link.relationshipType)?.label ?? link.relationshipType;
                const reviewBy = latest?.reviewBy ? new Date(latest.reviewBy) : null;
                const expiringSoon =
                    reviewBy &&
                    (status === "APPROVED" || status === "APPROVED_WITH_CONDITIONS") &&
                    reviewBy.getTime() - Date.now() < EXPIRING_SOON_DAYS * 86400000;

                return (
                    <Card key={link.id} withBorder radius="md" padding="sm">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <div>
                                <Group gap="xs">
                                    <Text fw={600} size="sm">{link.counterpartyName || "Relationship"}</Text>
                                    <Badge variant="light" size="sm">{relLabel}</Badge>
                                    <Badge color={meta.color} size="sm">{meta.label}</Badge>
                                </Group>
                                <Text size="sm" mt={4}>{link.description}</Text>
                                {latest?.conditions && (
                                    <Text size="sm" mt={4} c="teal">Board conditions: {latest.conditions}</Text>
                                )}
                                {reviewBy && (status === "APPROVED" || status === "APPROVED_WITH_CONDITIONS") && (
                                    <Text size="xs" c={expiringSoon ? "orange" : "dimmed"} mt={4}>
                                        Valid until {reviewBy.toISOString().slice(0, 10)}
                                        {expiringSoon ? " — expiring soon" : ""}
                                    </Text>
                                )}
                            </div>
                            <Group gap="xs" style={{ flexShrink: 0 }}>
                                {latest && isRenewable(status) && (
                                    <Button size="xs" variant="light" onClick={() => act(link.id, "renew")}>
                                        Resubmit
                                    </Button>
                                )}
                                {latest && status !== "REVOKED" && (
                                    <Button size="xs" variant="subtle" color="red" onClick={() => act(link.id, "withdraw")}>
                                        Withdraw
                                    </Button>
                                )}
                            </Group>
                        </Group>
                    </Card>
                );
            })}

            <Modal opened={opened} onClose={close} title="Disclose a relationship" size="lg">
                <Stack>
                    <Select
                        label="Relationship type"
                        data={RELATIONSHIP_TYPES}
                        value={relationshipType}
                        onChange={setRelationshipType}
                        required
                    />
                    <TextInput
                        label="Other person's name"
                        description="Who is this relationship with?"
                        value={counterpartyName}
                        onChange={(e) => setCounterpartyName(e.currentTarget.value)}
                    />
                    <TextInput
                        label="Their contact (optional)"
                        value={counterpartyContact}
                        onChange={(e) => setCounterpartyContact(e.currentTarget.value)}
                    />
                    <Textarea
                        label="Describe the relationship"
                        minRows={3}
                        autosize
                        value={description}
                        onChange={(e) => setDescription(e.currentTarget.value)}
                        required
                    />
                    {error && <Text c="red" size="sm">{error}</Text>}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={close}>Cancel</Button>
                        <Button
                            onClick={submit}
                            loading={submitting}
                            disabled={!relationshipType || !description.trim() || !counterpartyName.trim()}
                        >
                            Submit for board review
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
