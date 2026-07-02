"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import type { MembershipProcessStatus, MembershipStatus } from "@/generated/prisma/client";
import {
  Alert, Anchor, Box, Button, Card, Center, Checkbox, Container, Group, Loader,
  SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title,
} from "@mantine/core";
import MembershipFlowStepper from "@/components/MembershipFlowStepper";
import { notifyNavRefresh } from "@/lib/nav-refresh";
import { pickAddress, type StructuredAddress } from "@/lib/address";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import { useUnsavedGuard, useConfirmNav } from "@/components/UnsavedChangesProvider";
import AddressForm from "@/components/membership/AddressForm";
import EmergencyContactForm from "@/components/membership/EmergencyContactForm";
import ChildrenListForm from "@/components/membership/ChildrenListForm";

const blankAddress: StructuredAddress = { line1: "", line2: "", city: "", state: "", postalCode: "" };

interface PersonPrefill {
  id: number;
  name: string | null;
  email: string | null;
  dob: string | null;
  allergies: string | null;
}

interface ExternalStatus {
  contractSigned: boolean;
  contractStarted: boolean;
  bgConsented: boolean;
  bgCleared: boolean;
  deepLinkUrl: string | null;
}

interface IntakeState {
  hasHousehold: boolean;
  membershipStatus: MembershipStatus | null;
  process: { id: number; kind: string; status: MembershipProcessStatus } | null;
  external: ExternalStatus | null;
  prefill: {
    household: ({ name: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactEmail: string | null } & Partial<StructuredAddress>) | null;
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

interface FormValues {
  address: StructuredAddress;
  emName: string; emPhone: string; emEmail: string;
  primaryName: string; primaryDob: string; primaryAllergies: string;
  hasSecondary: boolean; secondaryId?: number;
  secondaryName: string; secondaryEmail: string; secondaryDob: string; secondaryAllergies: string;
  children: ChildForm[];
}

// Stable key for the unsaved-changes dirty compare. Array (not object) so order
// is deterministic, and nested — children/address rule out the flat shallowEqual.
export const serializeMembershipForm = (v: FormValues) =>
  JSON.stringify([
    v.address.line1, v.address.line2, v.address.city, v.address.state, v.address.postalCode,
    v.emName, v.emPhone, v.emEmail,
    v.primaryName, v.primaryDob, v.primaryAllergies,
    v.hasSecondary, v.secondaryId, v.secondaryName, v.secondaryEmail, v.secondaryDob, v.secondaryAllergies,
    v.children.map((c) => [c.id, c.name, c.email, c.dob, c.allergies]),
  ]);

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
  // Per-field validation errors, keyed by form field ("address", "emName",
  // "emPhone", "primaryName"). Drives the red-highlighted inputs.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Non-fatal notes from a save: parts that didn't go through (e.g. a second
  // guardian over the household cap) while the rest of the form did save.
  const [warnings, setWarnings] = useState<string[]>([]);

  // Intake form fields
  const [address, setAddress] = useState<StructuredAddress>(blankAddress);
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [emEmail, setEmEmail] = useState("");
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
  // Serialized form as last loaded/saved; isDirty compares it to current state.
  const [savedForm, setSavedForm] = useState<string | null>(null);

  const hydrate = useCallback((s: IntakeState) => {
    setState(s);
    const h = s.prefill.household;
    const a = pickAddress(h);
    const address = { line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "" };
    setAddress(address);
    setEmName(h?.emergencyContactName ?? "");
    setEmPhone(h?.emergencyContactPhone ?? "");
    setEmEmail(h?.emergencyContactEmail ?? "");
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
    const nextChildren = s.prefill.children.map((c) => ({
      id: c.id,
      name: c.name ?? "",
      email: c.email ?? "",
      dob: c.dob ?? "",
      allergies: c.allergies ?? "",
    }));
    setChildren(nextChildren);
    // Snapshot the just-loaded values so isDirty starts false (state setters
    // above haven't applied yet, so derive the snapshot straight from `s`).
    setSavedForm(serializeMembershipForm({
      address,
      emName: h?.emergencyContactName ?? "",
      emPhone: h?.emergencyContactPhone ?? "",
      emEmail: h?.emergencyContactEmail ?? "",
      primaryName: p?.name ?? "",
      primaryDob: p?.dob ?? "",
      primaryAllergies: p?.allergies ?? "",
      hasSecondary: !!sec,
      secondaryId: sec?.id,
      secondaryName: sec?.name ?? "",
      secondaryEmail: sec?.email ?? "",
      secondaryDob: sec?.dob ?? "",
      secondaryAllergies: sec?.allergies ?? "",
      children: nextChildren,
    }));
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

  // Return from embedded signing: Zoho redirects back with ?signed=1 (or
  // ?declined=1). Sync the contract status straight from Zoho rather than waiting
  // on the inbound webhook (ops-dev is scale-to-zero and may be asleep when Zoho
  // fires it), refresh, then strip the query so a manual reload doesn't re-run.
  const signReturnHandled = useRef(false);
  useEffect(() => {
    if (sessionStatus !== "authenticated" || signReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const signed = params.get("signed") === "1";
    const declined = params.get("declined") === "1";
    if (!signed && !declined) return;
    signReturnHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (declined) {
      setMessage("You declined the agreement. You can restart signing when you're ready.");
      setIsError(true);
      return;
    }
    (async () => {
      let signedNow = false;
      try {
        const res = await fetch("/api/membership/contract/sync", { method: "POST" });
        const data = await res.json().catch(() => null);
        signedNow = !!data?.status?.contractSigned;
      } catch {
        /* best-effort — the Zoho webhook is still a backstop */
      }
      await load();
      setMessage(
        signedNow
          ? "Thanks — your signature was received."
          : "Signature received — finalizing. If it doesn't update shortly, use “Refresh status”.",
      );
      setIsError(false);
    })();
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
    // Clear stale warnings when starting an action (msg === "") or on a hard
    // failure; a successful save sets them right after this call.
    if (error || msg === "") setWarnings([]);
  };

  // Build an error message from an API response, appending the dev-only `detail`
  // (the real server failure) when present so an "Internal Server Error" isn't a
  // dead end. Falls back to a friendly default when the body carries nothing.
  const apiError = (data: { error?: string; detail?: string } | null | undefined, fallback: string) =>
    [data?.error, data?.detail].filter(Boolean).join(" — ") || fallback;

  // Clear a single field's error (called as the user edits it).
  const clearErr = (key: string) =>
    setFieldErrors((fe) => (fe[key] ? Object.fromEntries(Object.entries(fe).filter(([k]) => k !== key)) : fe));

  // Required-field check for submit, mirroring the server's rules so the user
  // gets instant red-box feedback on every environment (no round-trip needed).
  const validateIntake = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!address.line1?.trim()) errs.address = "Home address is required.";
    if (!emName.trim()) errs.emName = "Emergency contact name is required.";
    if (!emPhone.trim()) errs.emPhone = "Emergency contact phone is required.";
    if (emEmail.trim() && !isValidEmail(emEmail)) errs.emEmail = "That email address doesn't look right.";
    if (!primaryName.trim()) errs.primaryName = "Your name is required.";
    return errs;
  };

  // Map the server's field keys (from an `incomplete` submit) onto form inputs —
  // covers cases the client can't detect locally (e.g. an emergency contact that
  // is itself a household member).
  const mapServerFields = (fields?: string[]): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of fields ?? []) {
      if (f === "address") errs.address = "Home address is required.";
      else if (f === "primaryName") errs.primaryName = "Your name is required.";
      else if (f === "emergencyContact") {
        errs.emName = "Add an emergency contact who isn't in your household.";
        errs.emPhone = "Add an emergency contact who isn't in your household.";
      }
    }
    return errs;
  };

  const startApplication = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership", { method: "POST" });
      const data = await res.json();
      if (res.ok) { hydrate(data.state); notifyNavRefresh(); }
      else flash(apiError(data, "Could not start your application."), true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const buildPayload = () => ({
    household: { ...address, emergencyContactName: emName, emergencyContactPhone: emPhone, emergencyContactEmail: emEmail },
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
        setWarnings((data.rejections ?? []).map((r: { message: string }) => r.message));
      } else flash(apiError(data, "Could not save."), true);
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    // Highlight missing required fields up front — instant feedback, no round-trip.
    const errs = validateIntake();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      flash("Please complete the highlighted fields.", true);
      return;
    }

    setSaving(true);
    flash("");
    try {
      // Persist latest edits first, then advance.
      const saveRes = await fetch("/api/membership/intake", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        flash(apiError(saveData, "Could not save."), true);
        return;
      }
      const saveWarnings: string[] = (saveData.rejections ?? []).map((r: { message: string }) => r.message);
      const res = await fetch("/api/membership/intake/submit", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setFieldErrors({});
        hydrate(data.state);
        notifyNavRefresh();
        flash("Submitted! Next: sign your contract and start your background check — then you can pay right away.");
        setWarnings(saveWarnings);
      } else {
        // The server may flag fields the client can't check locally (e.g. an
        // emergency contact who is a household member) — highlight those too.
        if (data.fields) setFieldErrors(mapServerFields(data.fields));
        flash(apiError(data, "Could not submit."), true);
      }
    } catch {
      flash("Network error.", true);
    } finally {
      setSaving(false);
    }
  };

  // "Sign your membership agreement" — create/reuse the Zoho request and go
  // straight into the embedded signing ceremony. The contract task flips to ✓
  // automatically (Zoho webhook) when the applicant returns signed.
  const startSigning = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership/contract/sign", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        flash(apiError(data, "Couldn't open the signing form. Please try again."), true);
        setSaving(false);
      }
    } catch {
      flash("Network error.", true);
      setSaving(false);
    }
    // On success we navigate away, so we intentionally leave `saving` true.
  };

  const renew = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/membership/renew", { method: "POST" });
      const data = await res.json();
      if (res.ok) { await load(); notifyNavRefresh(); flash("Renewal started."); }
      else flash(apiError(data, "Could not start renewal."), true);
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

  const currentForm = serializeMembershipForm({
    address, emName, emPhone, emEmail,
    primaryName, primaryDob, primaryAllergies,
    hasSecondary, secondaryId, secondaryName, secondaryEmail, secondaryDob, secondaryAllergies,
    children,
  });
  // Dirty once the user edits past the loaded snapshot. Re-hydrate after a
  // save/submit re-snapshots, so this flips back to false then.
  const isDirty = savedForm !== null && currentForm !== savedForm;
  useUnsavedGuard(isDirty);
  const confirmNav = useConfirmNav();

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
    <Container size="lg" pb="md">
      <Group justify="space-between" align="center" wrap="wrap" mb="lg">
        <Title order={1}>Treehouse Membership</Title>
        <Button component={Link} href="/" variant="default" onNavigate={(e) => { if (!confirmNav()) e.preventDefault(); }}>← Home</Button>
      </Group>

      {message && <Alert color={isError ? "red" : "green"} mb="lg">{message}</Alert>}

      {warnings.length > 0 && (
        <Alert color="yellow" mb="lg" title="Saved — with a couple of things to know">
          <Stack gap="xs">
            {warnings.map((w, i) => <Text key={i} size="sm">{w}</Text>)}
          </Stack>
        </Alert>
      )}

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
            <Anchor component={Link} href="/my-household">Update your household details first</Anchor>.
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
                    <AddressForm address={address} onChange={setAddress} error={fieldErrors.address} onErrorClear={() => clearErr("address")} />
                    <EmergencyContactForm
                      emName={emName} setEmName={setEmName}
                      emPhone={emPhone} setEmPhone={setEmPhone}
                      emEmail={emEmail} setEmEmail={setEmEmail}
                      errors={fieldErrors}
                      clearErr={clearErr}
                    />
                  </section>

                  <section>
                    <Title order={2} mb="sm">Primary parent / guardian</Title>
                    <TextInput label="Full name" value={primaryName} error={fieldErrors.primaryName} onChange={(e) => { setPrimaryName(e.currentTarget.value); clearErr("primaryName"); }} />
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

                  <ChildrenListForm items={children} onAdd={addChild} onUpdate={updateChild} onRemove={removeChild} />

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
                    <Title order={2}>Sign &amp; start your background check</Title>
                    <Text c="dimmed">
                      Once your agreement is signed and your background check is underway, we&apos;ll
                      move you straight to payment — you won&apos;t have to wait for the check to come
                      back.
                    </Text>
                  </div>

                  <ExternalTask done={!!state.external?.contractSigned} title="Sign your membership agreement" doneText="Agreement signed — thank you!">
                    <Stack gap="xs" align="flex-start">
                      <Text c="dimmed">
                        Sign your personalized membership agreement online. This page updates
                        automatically once it&apos;s signed.
                      </Text>
                      <Button color="green" disabled={saving} loading={saving} onClick={startSigning}>
                        {state.external?.contractStarted ? "Resume signing →" : "Sign your membership agreement →"}
                      </Button>
                    </Stack>
                  </ExternalTask>

                  {state.external?.bgCleared ? (
                    <ExternalTask done title="Background check" doneText="Your household&apos;s background check is still valid — no new check needed.">
                      <Text c="dimmed" />
                    </ExternalTask>
                  ) : (
                    <ExternalTask done={!!state.external?.bgConsented} title="Start your background check" doneText="Background check started — we&apos;ll finish it in the background.">
                      <Stack gap="xs" align="flex-start">
                        <Text c="dimmed">
                          Consent to your background check on Averity. It runs in the background — you
                          can keep going and pay while it completes.
                        </Text>
                        {state.external?.deepLinkUrl ? (
                          <Button component="a" href={state.external.deepLinkUrl} target="_blank" rel="noopener noreferrer">
                            Consent on Averity →
                          </Button>
                        ) : (
                          <Text c="dimmed">The background-check link isn&apos;t available yet. Please check back shortly.</Text>
                        )}
                      </Stack>
                    </ExternalTask>
                  )}

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
                    {!state.external?.bgCleared && (
                      <Alert color="blue" variant="light" mt="md">
                        Your background check is being reviewed in the background — you can pay now.
                        Your membership activates as soon as both the payment and the check are done.
                      </Alert>
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
            ) : inStatus === "PENDING_BG_CLEARANCE" ? (
              <Card withBorder radius="md" padding="lg">
                <Title order={2} mb="sm">Payment received 🎉</Title>
                <Text c="dimmed">
                  Thanks — your dues are paid. We&apos;re just finishing your background check. Your
                  membership activates automatically the moment it clears, and we&apos;ll email you
                  then. Nothing else to do.
                </Text>
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
