"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import type { MembershipProcessStatus, MembershipStatus } from "@/generated/prisma/client";
import {
  Alert, Anchor, Box, Button, Card, Center, Checkbox, Container, Group, Loader,
  SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title,
} from "@mantine/core";
import MembershipFlowStepper from "@/components/MembershipFlowStepper";
import { notifyNavRefresh } from "@/lib/nav-refresh";

interface PersonPrefill {
  id: number;
  name: string | null;
  email: string | null;
  dob: string | null;
  allergies: string | null;
}

interface ExternalStatus {
  contractSigned: boolean;
  bgConsented: boolean;
  deepLinkUrl: string | null;
}

interface IntakeState {
  hasHousehold: boolean;
  membershipStatus: MembershipStatus | null;
  process: { id: number; kind: string; status: MembershipProcessStatus } | null;
  external: ExternalStatus | null;
  prefill: {
    household: { name: string | null; address: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null } | null;
    primaryParent: PersonPrefill | null;
    secondaryParent: PersonPrefill | null;
    children: PersonPrefill[];
  };
}

interface ChildForm {
  id?: number;
  name: string;
  email: string;
  dob: string;
  allergies: string;
}

function ExternalTask({ done, title, doneText, children }: { done: boolean; title: string; doneText: string; children: React.ReactNode }) {
  return (
    <Card withBorder radius="md" padding="md" bg={done ? "var(--mantine-color-green-light)" : undefined}>
      <Group align="flex-start" wrap="nowrap">
        <ThemeIcon color={done ? "green" : "gray"} radius="xl" size="md" variant={done ? "filled" : "light"}>
          {done ? "✓" : "•"}
        </ThemeIcon>
        <Box style={{ flex: 1 }}>
          <Text fw={600} mb="xs">{title}</Text>
          {done ? <Text c="green">{doneText}</Text> : children}
        </Box>
      </Group>
    </Card>
  );
}

export default function MembershipPage() {
  const { data: session, status: sessionStatus } = useSession();

  const [state, setState] = useState<IntakeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  // Intake form fields
  const [address, setAddress] = useState("");
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [primaryName, setPrimaryName] = useState("");
  const [primaryDob, setPrimaryDob] = useState("");
  const [primaryAllergies, setPrimaryAllergies] = useState("");
  const [hasSecondary, setHasSecondary] = useState(false);
  const [secondaryId, setSecondaryId] = useState<number | undefined>(undefined);
  const [secondaryName, setSecondaryName] = useState("");
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [secondaryDob, setSecondaryDob] = useState("");
  const [secondaryAllergies, setSecondaryAllergies] = useState("");
  const [children, setChildren] = useState<ChildForm[]>([]);
  const [payment, setPayment] = useState<{ amountCents: number; checkoutUrl: string | null } | null>(null);

  const hydrate = useCallback((s: IntakeState) => {
    setState(s);
    const h = s.prefill.household;
    setAddress(h?.address ?? "");
    setEmName(h?.emergencyContactName ?? "");
    setEmPhone(h?.emergencyContactPhone ?? "");
    const p = s.prefill.primaryParent;
    setPrimaryName(p?.name ?? "");
    setPrimaryDob(p?.dob ?? "");
    setPrimaryAllergies(p?.allergies ?? "");
    const sec = s.prefill.secondaryParent;
    if (sec) {
      setHasSecondary(true);
      setSecondaryId(sec.id);
      setSecondaryName(sec.name ?? "");
      setSecondaryEmail(sec.email ?? "");
      setSecondaryDob(sec.dob ?? "");
      setSecondaryAllergies(sec.allergies ?? "");
    }
    setChildren(
      s.prefill.children.map((c) => ({
        id: c.id,
        name: c.name ?? "",
        email: c.email ?? "",
        dob: c.dob ?? "",
        allergies: c.allergies ?? "",
      }))
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/membership");
      if (res.ok) hydrate(await res.json());
    } catch {
      /* shown via empty state */
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    if (sessionStatus === "authenticated") load();
    else if (sessionStatus === "unauthenticated") setLoading(false);
  }, [sessionStatus, load]);

  // When awaiting payment, fetch the dues amount and Shopify checkout link.
  useEffect(() => {
    if (state?.process?.status !== "PENDING_PAYMENT") return;
    let cancelled = false;
    fetch("/api/membership/payment")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setPayment(data); })
      .catch(() => { /* shown as link-unavailable */ });
    return () => { cancelled = true; };
  }, [state?.process?.status]);

  const flash = (msg: string, error = false) => {
    setMessage(msg);
    setIsError(error);
  };

  const startApplication = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership", { method: "POST" });
      const data = await res.json();
      if (res.ok) { hydrate(data.state); notifyNavRefresh(); }
      else flash(data.error || "Could not start your application.", true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const buildPayload = () => ({
    household: { address, emergencyContactName: emName, emergencyContactPhone: emPhone },
    primaryParent: { name: primaryName, dob: primaryDob || null, allergies: primaryAllergies || null },
    secondaryParent: hasSecondary
      ? { id: secondaryId, name: secondaryName, email: secondaryEmail || undefined, dob: secondaryDob || null, allergies: secondaryAllergies || null }
      : null,
    children: children
      .filter((c) => c.name.trim())
      .map((c) => ({ id: c.id, name: c.name, email: c.email || null, dob: c.dob || null, allergies: c.allergies || null })),
  });

  const save = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership/intake", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (res.ok) {
        hydrate(data.state);
        flash("Progress saved.");
      } else flash(data.error || "Could not save.", true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    flash("");
    try {
      // Persist latest edits first, then advance.
      const saveRes = await fetch("/api/membership/intake", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json();
        flash(d.error || "Could not save.", true);
        return;
      }
      const res = await fetch("/api/membership/intake/submit", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        hydrate(data.state);
        notifyNavRefresh();
        flash("Submitted! Next: sign your contract and consent to a background check.");
      } else flash(data.error || "Could not submit.", true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const renew = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership/renew", { method: "POST" });
      const data = await res.json();
      if (res.ok) { await load(); notifyNavRefresh(); flash("Renewal started."); }
      else flash(data.error || "Could not start renewal.", true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const addChild = () => setChildren((c) => [...c, { name: "", email: "", dob: "", allergies: "" }]);
  const updateChild = (i: number, field: keyof ChildForm, value: string) =>
    setChildren((c) => c.map((child, idx) => (idx === i ? { ...child, [field]: value } : child)));
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));

  if (sessionStatus === "loading" || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session?.user) {
    return (
      <Container size="xs" py="xl">
        <Card withBorder radius="md" padding="xl" ta="center">
          <Title order={1}>Join the Treehouse</Title>
          <Text c="dimmed" my="md">Please sign in to start your membership application.</Text>
          <Button component={Link} href="/">Go to sign in</Button>
        </Card>
      </Container>
    );
  }

  const inStatus = state?.process?.status ?? null;
  const isIntake = inStatus === "INTAKE";
  const isActive = state?.membershipStatus === "ACTIVE";
  const isRenewal = state?.process?.kind === "RENEWAL";

  return (
    <Container size="lg" py="md">
      <Group justify="space-between" align="center" wrap="wrap" mb="lg">
        <Title order={1}>Treehouse Membership</Title>
        <Button component={Link} href="/" variant="default">← Home</Button>
      </Group>

      {message && <Alert color={isError ? "red" : "green"} mb="lg">{message}</Alert>}

      {!state?.process ? (
        isActive ? (
          <Card withBorder radius="md" padding="xl">
            <Title order={2}>You&apos;re a member 🎉</Title>
            <Text c="dimmed" mt="sm">Your household membership is active. Thank you for being part of the Treehouse!</Text>
          </Card>
        ) : (
          <Card withBorder radius="md" padding="xl" maw={640}>
            <Title order={2}>Become a member</Title>
            <Text c="dimmed" my="md">
              Membership is for your whole household. We&apos;ll collect some information about your
              family, then walk you through signing a contract, a background check, and payment. You
              can stop and resume anytime.
            </Text>
            <Button disabled={saving} loading={saving} onClick={startApplication}>Start application</Button>
          </Card>
        )
      ) : isRenewal && inStatus === "PENDING_RENEWAL" ? (
        <Card withBorder radius="md" padding="xl" maw={640}>
          <Title order={2}>Time to renew</Title>
          <Text c="dimmed" my="md">
            Your household membership is up for renewal. You&apos;re still an active member — confirm
            below to continue for another year. No contract to re-sign; we&apos;ll only re-check a
            background if it has expired.
          </Text>
          <Text c="dimmed" mb="md">
            Did anything change — new members, address, phone, or email?{" "}
            <Anchor component={Link} href="/household">Update your household details first</Anchor>.
          </Text>
          <Button color="green" disabled={saving} loading={saving} onClick={renew}>Renew now</Button>
        </Card>
      ) : isRenewal && inStatus === "RENEWAL_PENDING_BG" ? (
        <Card withBorder radius="md" padding="xl" maw={640}>
          <Title order={2}>Renewal in progress</Title>
          <Text c="dimmed" mt="md">
            We&apos;re re-confirming your household&apos;s background check (the previous one has
            expired). You&apos;ll be able to pay once that&apos;s done. Your membership stays active
            in the meantime.
          </Text>
        </Card>
      ) : (
        <Group align="flex-start" gap="xl" wrap="wrap">
          {!isRenewal && (
            <Box style={{ flex: "0 0 auto" }}>
              <MembershipFlowStepper currentStatus={inStatus} />
            </Box>
          )}

          <Box style={{ flex: "1 1 420px", minWidth: 320 }}>
            {isIntake ? (
              <Card withBorder radius="md" padding="lg">
                <Stack gap="lg">
                  <section>
                    <Title order={2} mb="sm">Your household</Title>
                    <TextInput label="Home address" value={address} onChange={(e) => setAddress(e.currentTarget.value)} placeholder="123 Main St, City, State ZIP" />
                    <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
                      <TextInput label="Emergency contact name" value={emName} onChange={(e) => setEmName(e.currentTarget.value)} />
                      <TextInput label="Emergency contact phone" value={emPhone} onChange={(e) => setEmPhone(e.currentTarget.value)} />
                    </SimpleGrid>
                  </section>

                  <section>
                    <Title order={2} mb="sm">Primary parent / guardian</Title>
                    <TextInput label="Full name" value={primaryName} onChange={(e) => setPrimaryName(e.currentTarget.value)} />
                    <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
                      <TextInput type="date" label="Date of birth" value={primaryDob} onChange={(e) => setPrimaryDob(e.currentTarget.value)} />
                      <TextInput label="Allergies (optional)" value={primaryAllergies} onChange={(e) => setPrimaryAllergies(e.currentTarget.value)} />
                    </SimpleGrid>
                  </section>

                  <section>
                    <Checkbox
                      checked={hasSecondary}
                      onChange={(e) => setHasSecondary(e.currentTarget.checked)}
                      label="Add a second parent / guardian"
                    />
                    {hasSecondary && (
                      <Stack mt="sm">
                        <TextInput label="Full name" value={secondaryName} onChange={(e) => setSecondaryName(e.currentTarget.value)} />
                        <SimpleGrid cols={{ base: 1, sm: 2 }}>
                          <TextInput type="email" label="Email (optional)" value={secondaryEmail} onChange={(e) => setSecondaryEmail(e.currentTarget.value)} />
                          <TextInput type="date" label="Date of birth" value={secondaryDob} onChange={(e) => setSecondaryDob(e.currentTarget.value)} />
                        </SimpleGrid>
                        <TextInput label="Allergies (optional)" value={secondaryAllergies} onChange={(e) => setSecondaryAllergies(e.currentTarget.value)} />
                      </Stack>
                    )}
                  </section>

                  <section>
                    <Group justify="space-between" align="center" mb="sm">
                      <Title order={2}>Children</Title>
                      <Button variant="light" size="xs" onClick={addChild}>+ Add child</Button>
                    </Group>
                    {children.length === 0 && <Text c="dimmed">No children added yet.</Text>}
                    <Stack>
                      {children.map((child, i) => (
                        <Card key={child.id ?? `new-${i}`} withBorder radius="md" padding="md">
                          <Group justify="space-between" align="center" mb="xs">
                            <Text fw={600}>Child {i + 1}</Text>
                            <Button variant="subtle" color="red" size="compact-sm" onClick={() => removeChild(i)}>Remove</Button>
                          </Group>
                          <TextInput label="Full name" value={child.name} onChange={(e) => updateChild(i, "name", e.currentTarget.value)} />
                          <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm">
                            <TextInput type="date" label="Date of birth" value={child.dob} onChange={(e) => updateChild(i, "dob", e.currentTarget.value)} />
                            <TextInput type="email" label="Email (optional)" value={child.email} onChange={(e) => updateChild(i, "email", e.currentTarget.value)} />
                          </SimpleGrid>
                          <TextInput mt="sm" label="Allergies (optional)" value={child.allergies} onChange={(e) => updateChild(i, "allergies", e.currentTarget.value)} />
                        </Card>
                      ))}
                    </Stack>
                  </section>

                  <Group gap="md" wrap="wrap">
                    <Button variant="default" disabled={saving} loading={saving} onClick={save}>Save progress</Button>
                    <Button color="green" disabled={saving} loading={saving} onClick={submit}>Submit &amp; continue</Button>
                  </Group>
                </Stack>
              </Card>
            ) : inStatus === "PENDING_EXTERNAL_ACTION" ? (
              <Card withBorder radius="md" padding="lg">
                <Stack gap="md">
                  <div>
                    <Title order={2}>Two quick steps</Title>
                    <Text c="dimmed">
                      These can be done in any order. We&apos;ll move you forward automatically once
                      both are complete.
                    </Text>
                  </div>

                  <ExternalTask done={!!state.external?.contractSigned} title="Sign your membership contract" doneText="Contract signed — thank you!">
                    <Text c="dimmed">
                      We&apos;ve sent your membership contract via Zoho Sign. Please check your email
                      and sign it. This page updates automatically once it&apos;s signed.
                    </Text>
                  </ExternalTask>

                  <ExternalTask done={!!state.external?.bgConsented} title="Consent to a background check" doneText="Background-check consent received.">
                    {state.external?.deepLinkUrl ? (
                      <Button component="a" href={state.external.deepLinkUrl} target="_blank" rel="noopener noreferrer">
                        Consent on Averity →
                      </Button>
                    ) : (
                      <Text c="dimmed">The background-check link isn&apos;t available yet. Please check back shortly.</Text>
                    )}
                  </ExternalTask>

                  <Button variant="default" disabled={saving} onClick={load} style={{ alignSelf: "flex-start" }}>
                    Refresh status
                  </Button>
                </Stack>
              </Card>
            ) : inStatus === "PENDING_PAYMENT" ? (
              <Card withBorder radius="md" padding="lg">
                <Title order={2} mb="sm">Membership dues</Title>
                {payment ? (
                  <>
                    <Text c="dimmed">
                      Your annual household dues are <strong>${(payment.amountCents / 100).toFixed(2)}</strong>.
                    </Text>
                    {payment.checkoutUrl ? (
                      <Button component="a" href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer" color="green" mt="md">
                        Pay here with Shopify →
                      </Button>
                    ) : (
                      <Text c="yellow" mt="md">The payment link isn&apos;t available yet. Please check back shortly.</Text>
                    )}
                    <Text size="sm" c="dimmed" mt="lg">
                      To discuss alternative arrangements, please email{" "}
                      <Anchor href="mailto:finance@innovationtreehouse.org">finance@innovationtreehouse.org</Anchor>.
                    </Text>
                  </>
                ) : (
                  <Text c="dimmed">Preparing your invoice…</Text>
                )}
              </Card>
            ) : (
              <Card withBorder radius="md" padding="xl">
                <Title order={2}>Application in progress</Title>
                <Text c="dimmed" mt="sm">
                  Your information is in. Follow the steps on the left — the next stages (background
                  check and payment) will appear here as they open.
                </Text>
              </Card>
            )}
          </Box>
        </Group>
      )}
    </Container>
  );
}
