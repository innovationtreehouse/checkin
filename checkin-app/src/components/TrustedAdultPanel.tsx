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
import { modals } from "@mantine/modals";
import { IconAlertTriangle, IconPlus } from "@tabler/icons-react";
import { normalizePhone, isValidEmail } from "@/lib/emergencyContacts/identity";
import { TrustedAdultContact } from "@/components/TrustedAdultContact";

const STATUS_META: Record<string, { label: string; color: string }> = {
    PENDING_BOARD_REVIEW: { label: "Awaiting board review", color: "yellow" },
    PENDING_SUBJECT_ACTION: { label: "Board needs more info — see email", color: "orange" },
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
    trustedAdultName: string | null;
    trustedAdultPhone: string | null;
    trustedAdultEmail: string | null;
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
    const [attempted, setAttempted] = useState(false);

    const [trustedAdultName, setTrustedAdultName] = useState("");
    const [trustedAdultPhone, setTrustedAdultPhone] = useState("");
    const [trustedAdultEmail, setTrustedAdultEmail] = useState("");
    const [familyContext, setFamilyContext] = useState("");

    const closeModal = useCallback(() => {
        setAttempted(false);
        close();
    }, [close]);

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
                body: JSON.stringify({ trustedAdultName, trustedAdultPhone, trustedAdultEmail, familyContext }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Could not submit.");
                return;
            }
            close();
            setTrustedAdultName("");
            setTrustedAdultPhone("");
            setTrustedAdultEmail("");
            setFamilyContext("");
            setAttempted(false);
            load();
        } finally {
            setSubmitting(false);
        }
    }

    async function act(id: number, action: "renew" | "withdraw" | "hide") {
        const res = await fetch(`/api/trusted-adults/${id}/${action}`, { method: "POST" });
        if (res.ok) load();
        else {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? "Action failed.");
        }
    }

    // Permanently hides a withdrawn trusted adult from the household's view. The
    // record is kept for the board/audit — confirm because it can't be undone here.
    function confirmDelete(ta: TrustedAdult) {
        modals.openConfirmModal({
            title: "Delete this trusted adult?",
            children: (
                <Text size="sm">
                    This permanently removes <strong>{ta.trustedAdultName || "this trusted adult"}</strong> from your
                    list. You won&apos;t see it again. The board keeps a record for its files.
                </Text>
            ),
            labels: { confirm: "Delete", cancel: "Cancel" },
            confirmProps: { color: "red" },
            onConfirm: () => act(ta.id, "hide"),
        });
    }

    // Validate phone and email independently so both light up at once when both
    // are wrong. At least one contact method is required. Errors surface only
    // after a submit attempt — never while typing.
    const phoneTrim = trustedAdultPhone.trim();
    const emailTrim = trustedAdultEmail.trim();
    const missingContact = !phoneTrim && !emailTrim;
    const phoneBad = !!phoneTrim && normalizePhone(phoneTrim).length < 10;
    const emailBad = !!emailTrim && !isValidEmail(emailTrim);
    const contactInvalid = missingContact || phoneBad || emailBad;

    const nameError = attempted && !trustedAdultName.trim() ? "Enter the trusted adult's name." : undefined;
    const phoneError = attempted && phoneBad ? "That phone number doesn't look right."
        : attempted && missingContact ? "Enter a phone number or an email — at least one."
            : undefined;
    const emailError = attempted && emailBad ? "That email address doesn't look right." : undefined;
    const contextError = attempted && !familyContext.trim() ? "Add the board context." : undefined;

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
                                    <Text fw={600} size="sm">{ta.trustedAdultName || "Trusted adult"}</Text>
                                    <Badge color={meta.color} size="sm">{meta.label}</Badge>
                                </Group>
                                <TrustedAdultContact phone={ta.trustedAdultPhone} email={ta.trustedAdultEmail} />
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
                                {status === "REVOKED" && (
                                    <Button size="xs" fz={15} variant="subtle" color="red" onClick={() => confirmDelete(ta)}>
                                        Delete
                                    </Button>
                                )}
                            </Group>
                        </Group>
                    </Card>
                );
            })}

            <Modal opened={opened} onClose={closeModal} title="Add a trusted adult" size="lg">
                <Stack>
                    <TextInput
                        label="Trusted adult's name"
                        value={trustedAdultName}
                        onChange={(e) => setTrustedAdultName(e.currentTarget.value)}
                        error={nameError}
                        required
                    />
                    <Text c="blue" fw={600} size="sm">
                        Phone or email is required — at least one.
                    </Text>
                    <TextInput
                        label="Their phone"
                        type="tel"
                        value={trustedAdultPhone}
                        onChange={(e) => setTrustedAdultPhone(e.currentTarget.value)}
                        error={phoneError}
                    />
                    <TextInput
                        label="Their email"
                        type="email"
                        value={trustedAdultEmail}
                        onChange={(e) => setTrustedAdultEmail(e.currentTarget.value)}
                        error={emailError}
                    />
                    <Textarea
                        label="For the board: your relationship to this adult, and any limits on it"
                        description="Seen only by the board and your household. Naming a trusted adult creates a Dual Relationship — it lets them have one-on-one contact with your Youth, message them privately, and transport them, without the usual Observable-and-Interruptible, open-communication, and travel rules defined in Treehouse policy. Tell us your relationship to them. If you want to narrow that scope — e.g. no transport, no private messaging, supervised only, or custody/contact restrictions — state it here."
                        minRows={4}
                        autosize
                        value={familyContext}
                        onChange={(e) => setFamilyContext(e.currentTarget.value)}
                        error={contextError}
                        required
                    />
                    {error && <Text c="red" size="sm">{error}</Text>}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeModal}>Cancel</Button>
                        <Button
                            onClick={() => {
                                setAttempted(true);
                                if (!trustedAdultName.trim() || contactInvalid || !familyContext.trim()) return;
                                submit();
                            }}
                            loading={submitting}
                        >
                            Submit for board review
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
