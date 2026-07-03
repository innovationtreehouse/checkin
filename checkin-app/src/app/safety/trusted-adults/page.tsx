"use client";

import { useState, useEffect, useCallback } from "react";
import {
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
    Tooltip,
} from "@mantine/core";
import { AlertBanner, type AlertTone } from "@/components/admin/AlertBanner";
import { TrustedAdultContact } from "@/components/TrustedAdultContact";
import { useRequireRole } from "@/hooks/useRequireRole";
import { isTrustedAdultConflict } from "@/lib/trusted-adult/conflict";
import { notifyNavRefresh } from "@/lib/nav-refresh";

interface Review {
    id: number;
    kind: string;
    status: string;
    decision: string | null;
    decisionNote: string | null;
    sharedNote: string | null;
    effectiveFrom: string | null;
    reviewBy: string | null;
    createdAt: string;
}
interface PersonRef {
    id: number;
    name: string | null;
    email: string | null;
}
interface HouseholdRef {
    id: number;
    name: string | null;
    leads: { person: PersonRef }[];
}
interface TrustedAdult {
    id: number;
    trustedAdultName: string | null;
    trustedAdultPhone: string | null;
    trustedAdultEmail: string | null;
    familyContext: string;
    origin: string;
    createdAt: string;
    household: HouseholdRef | null;
    trustedAdultPerson: PersonRef | null;
    reviews: Review[];
}

const STATUS_COLORS: Record<string, string> = {
    PENDING_BOARD_REVIEW: "yellow",
    PENDING_SUBJECT_ACTION: "orange",
    APPROVED: "green",
    DENIED: "red",
    EXPIRED: "gray",
    REVOKED: "gray",
};
const label = (s: string) => s.replace(/_/g, " ");

export default function AdminTrustedAdultsPage() {
    const { ready, loading: authLoading, user } = useRequireRole(["isSysadmin", "isBoardMember"]);
    const [items, setItems] = useState<TrustedAdult[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [shared, setShared] = useState<Record<number, string>>({});
    // Per-review confirmation, rendered card-local so the notice stays next to the
    // button that triggered it (a single page-top banner scrolls off-screen on long queues).
    const [notices, setNotices] = useState<Record<number, { text: string; tone: AlertTone }>>({});
    const clearNotice = (id: number) =>
        setNotices((n) => { const c = { ...n }; delete c[id]; return c; });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/safety/trusted-adults");
            if (res.ok) {
                const data = await res.json();
                setItems(data.trustedAdults || []);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (ready) load();
    }, [ready, load]);

    const decide = async (reviewId: number, decision: string, extra?: Record<string, unknown>) => {
        setBusyId(reviewId);
        clearNotice(reviewId);
        try {
            const res = await fetch("/api/safety/trusted-adults/decision", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewId, decision, ...extra }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setNotices((n) => ({ ...n, [reviewId]: { text: body.error ?? "Decision failed.", tone: "error" } }));
            } else {
                setNotices((n) => ({ ...n, [reviewId]: { text: `Recorded: ${label(body.status)}.`, tone: "success" } }));
                await load();
                notifyNavRefresh();
            }
        } finally {
            setBusyId(null);
        }
    };

    const override = async (reviewId: number, action: string, extra?: Record<string, unknown>) => {
        setBusyId(reviewId);
        clearNotice(reviewId);
        try {
            const res = await fetch("/api/safety/trusted-adults/override", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewId, action, ...extra }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setNotices((n) => ({ ...n, [reviewId]: { text: body.error ?? "Override failed.", tone: "error" } }));
            } else {
                // Override deliberately shows no success notice — just reload.
                await load();
                notifyNavRefresh();
            }
        } finally {
            setBusyId(null);
        }
    };

    if (authLoading || loading) {
        return (
            <Center h={200}>
                <Loader />
            </Center>
        );
    }

    if (!ready) return null;

    return (
        <Stack p="md">
            <div>
                <Title order={2}>Trusted Adults — Board Review</Title>
                <Text c="dimmed" size="sm">
                    Household-disclosed trusted adults (a.k.a. dual relationships) awaiting review, awaiting the family,
                    or expired. A single board member settles each. Approving requires a shared note that front-desk
                    keyholders and program leads will see.
                </Text>
            </div>

            {items.length === 0 && <Text c="dimmed">Nothing in the queue.</Text>}

            {items.map((ta) => {
                const latest = ta.reviews[0];
                const status = latest?.status ?? "PENDING_BOARD_REVIEW";
                const pending = status === "PENDING_BOARD_REVIEW";
                const sharedVal = latest ? shared[latest.id] ?? "" : "";
                // Conflict of interest: can't review your own household's trusted adult, nor
                // one where you are the counterparty. Backend enforces the same rule.
                const isSelf = isTrustedAdultConflict({
                    actorParticipantId: user?.id,
                    actorHouseholdId: user?.householdId,
                    taHouseholdId: ta.household?.id,
                    taTrustedAdultPersonId: ta.trustedAdultPerson?.id,
                });
                return (
                    <Card key={ta.id} withBorder radius="md" padding="md">
                        <Group gap="xs">
                            <Text fw={600}>{ta.household?.name || `Household ${ta.household?.id}`}</Text>
                            <Text c="dimmed">→</Text>
                            <Text>{ta.trustedAdultPerson?.name || ta.trustedAdultName || "trusted adult"}</Text>
                            <Badge color={STATUS_COLORS[status] ?? "gray"}>{label(status)}</Badge>
                            {latest && <Badge variant="outline">{label(latest.kind)}</Badge>}
                        </Group>
                        <TrustedAdultContact phone={ta.trustedAdultPhone} email={ta.trustedAdultEmail} />
                        <Text size="sm" mt={6}><b>Family context (board only):</b> {ta.familyContext}</Text>
                        {latest?.sharedNote && (
                            <Text size="sm" c="teal" mt={2}>Shared note (keyholders/program leads): {latest.sharedNote}</Text>
                        )}
                        {ta.household?.leads?.length ? (
                            <Text size="xs" c="dimmed" mt={2}>
                                Leads: {ta.household.leads.map((l) => l.person.name || l.person.email).join(", ")}
                            </Text>
                        ) : null}
                        {latest?.reviewBy && (
                            <Text size="xs" c="dimmed" mt={2}>Review by {latest.reviewBy.slice(0, 10)}</Text>
                        )}
                        <Text size="xs" c="dimmed" mt={2}>
                            Disclosed {ta.createdAt.slice(0, 10)} · {label(ta.origin)}
                        </Text>

                        {pending && latest && (
                            <Stack mt="md" gap="xs">
                                <Textarea
                                    withAsterisk
                                    label="Shared note — what keyholders & program leads should know (required to approve)"
                                    placeholder="e.g. Grandma (Jane Doe) may pick up Bobby and Sue."
                                    autosize
                                    minRows={2}
                                    value={sharedVal}
                                    onChange={(e) => { const value = e.currentTarget.value; setShared((s) => ({ ...s, [latest.id]: value })); }}
                                />
                                <Tooltip
                                    label="You can't review your own household's trusted adult — another board member must decide."
                                    multiline w={260}
                                    disabled={!isSelf}
                                >
                                    <Group gap="xs">
                                        <Tooltip
                                            label="Needs Shared Note to Approve"
                                            disabled={isSelf || !!sharedVal.trim()}
                                        >
                                            <span>
                                                <Button
                                                    size="xs" fz={15}
                                                    color="green"
                                                    loading={busyId === latest.id}
                                                    disabled={isSelf || !sharedVal.trim()}
                                                    onClick={() => decide(latest.id, "APPROVE", { sharedNote: sharedVal })}
                                                >
                                                    Approve
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        <Button size="xs" fz={15} color="red" loading={busyId === latest.id} disabled={isSelf} onClick={() => decide(latest.id, "DENY")}>
                                            Deny
                                        </Button>
                                        <Button
                                            size="xs" fz={15}
                                            variant="light"
                                            loading={busyId === latest.id}
                                            disabled={isSelf}
                                            onClick={() => {
                                                const note = window.prompt("What information do you need from the family?") ?? "";
                                                decide(latest.id, "REQUEST_INFO", { note });
                                            }}
                                        >
                                            Request info
                                        </Button>
                                    </Group>
                                </Tooltip>
                            </Stack>
                        )}

                        {latest && !pending && status !== "REVOKED" && (
                            <Group gap="xs" mt="md">
                                <Text size="xs" c="dimmed">Override:</Text>
                                <Button
                                    size="xs" fz={15}
                                    variant="subtle"
                                    color="green"
                                    loading={busyId === latest.id}
                                    onClick={() => {
                                        const note = window.prompt("Shared note (required to force-approve):") ?? "";
                                        if (note.trim()) override(latest.id, "approve", { sharedNote: note });
                                    }}
                                >
                                    Force approve
                                </Button>
                                <Button size="xs" fz={15} variant="subtle" color="red" loading={busyId === latest.id} onClick={() => override(latest.id, "deny")}>
                                    Force deny
                                </Button>
                                <Button size="xs" fz={15} variant="subtle" color="gray" loading={busyId === latest.id} onClick={() => override(latest.id, "revoke")}>
                                    Revoke
                                </Button>
                            </Group>
                        )}

                        {latest && notices[latest.id] && (
                            <AlertBanner
                                message={notices[latest.id].text}
                                tone={notices[latest.id].tone}
                                mt="xs"
                                onClose={() => clearNotice(latest.id)}
                            />
                        )}
                    </Card>
                );
            })}
        </Stack>
    );
}
