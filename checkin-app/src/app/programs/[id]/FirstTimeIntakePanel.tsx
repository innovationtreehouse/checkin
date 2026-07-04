"use client";

import { useState, useEffect } from "react";
import { Alert, Button, Center, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { pickAddress, type StructuredAddress } from "@/lib/address";
import { INTAKE_PROFILES, missingRequiredFields, type IntakeSubmitContext } from "@/lib/intake/profiles";
import AddressForm from "@/components/membership/AddressForm";
import EmergencyContactForm from "@/components/membership/EmergencyContactForm";
import ChildrenListForm from "@/components/membership/ChildrenListForm";

/**
 * First-time household setup for auth-first program registration (PR C). Shown
 * inline on /programs/[id] when a freshly-signed-in user has no enrollable
 * participant and/or no emergency contact. Collects the minimum the enroll step
 * needs, then hands control back so the existing member-select + Shopify flow
 * can run.
 *
 * Reuses the membership intake form components and the `program-first-time`
 * field profile (which drives shown/required fields) — no duplicated field list.
 * Saves via the process-free /api/household/intake route (NOT a membership
 * application). Participant email/phone is intentionally omitted here.
 */

const blankAddress: StructuredAddress = { line1: "", line2: "", city: "", state: "", postalCode: "" };

interface ChildForm {
  id?: number;
  name: string;
  email: string;
  dob: string;
  allergies: string;
}

export default function FirstTimeIntakePanel({ ageGated, onSaved }: { ageGated: boolean; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [address, setAddress] = useState<StructuredAddress>(blankAddress);
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [emEmail, setEmEmail] = useState("");
  const [primaryName, setPrimaryName] = useState("");
  const [primaryAllergies, setPrimaryAllergies] = useState("");
  const [children, setChildren] = useState<ChildForm[]>([]);

  const clearErr = (key: string) =>
    setFieldErrors((fe) => (fe[key] ? Object.fromEntries(Object.entries(fe).filter(([k]) => k !== key)) : fe));

  // Prefill from the caller's household so a returning user only sees the gaps.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/household/intake");
        if (!res.ok) return;
        const s = await res.json();
        if (cancelled) return;
        const h = s.prefill?.household;
        const a = pickAddress(h);
        setAddress({ line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "" });
        setEmName(h?.emergencyContactName ?? "");
        setEmPhone(h?.emergencyContactPhone ?? "");
        setEmEmail(h?.emergencyContactEmail ?? "");
        setPrimaryName(s.prefill?.primaryParent?.name ?? "");
        setPrimaryAllergies(s.prefill?.primaryParent?.allergies ?? "");
        setChildren(
          (s.prefill?.children ?? []).map((c: { id: number; name: string | null; dob: string | null; allergies: string | null }) => ({
            id: c.id,
            name: c.name ?? "",
            email: "",
            dob: c.dob ?? "",
            allergies: c.allergies ?? "",
          })),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addChild = () => setChildren((c) => [...c, { name: "", email: "", dob: "", allergies: "" }]);
  const updateChild = (i: number, field: keyof ChildForm, value: string) =>
    setChildren((c) => c.map((child, idx) => (idx === i ? { ...child, [field]: value } : child)));
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));

  const namedChildren = children.filter((c) => c.name.trim());

  // Required-ness comes from the program-first-time profile (single source of
  // truth), mapped onto the form's inputs for red-box feedback.
  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const ctx: IntakeSubmitContext = {
      emergencyContacts: emName.trim() && emPhone.trim() ? [{ conflictParticipantId: null, name: emName, phone: emPhone }] : [],
      primaryName,
      participants: namedChildren.map((c) => ({ dob: c.dob || null, ageGated })),
    };
    for (const m of missingRequiredFields(INTAKE_PROFILES["program-first-time"], ctx)) {
      if (m.field === "primaryName") errs.primaryName = "Your name is required.";
      else if (m.field === "emergencyContact") {
        errs.emName = "Add an emergency contact who isn't in your household.";
        errs.emPhone = "Add an emergency contact who isn't in your household.";
      } else if (m.field === "participantDob") errs.childDob = "Enter each participant's date of birth.";
    }
    // An age-gated program needs someone to actually enroll — nudge them to add
    // the child (participantDob is trivially satisfied when there are no children).
    if (ageGated && namedChildren.length === 0) errs.child = "Add the child you want to enroll.";
    return errs;
  };

  const save = async () => {
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError("Please complete the highlighted fields.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/household/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household: { ...address, emergencyContactName: emName, emergencyContactPhone: emPhone, emergencyContactEmail: emEmail },
          // No dob/over25 for the adult — leave their age untouched; they aren't
          // the age-gated enrollee.
          primaryParent: { name: primaryName, allergies: primaryAllergies || null },
          children: namedChildren.map((c) => ({ id: c.id, name: c.name, dob: c.dob || null, allergies: c.allergies || null })),
        }),
      });
      if (res.ok) {
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not save your details.");
      }
    } catch {
      notifications.show({ color: "red", message: "Network error saving your details.", autoClose: false });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Center py="md"><Loader size="sm" /></Center>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={4}>Finish setting up your household</Title>
        <Text c="dimmed" size="sm">We just need a few details before you can enroll.</Text>
      </div>

      <section>
        <Title order={5} mb="sm">{ageGated ? "Who are you enrolling?" : "Participants"}</Title>
        <ChildrenListForm items={children} onAdd={addChild} onUpdate={updateChild} onRemove={removeChild} hideEmail />
        {fieldErrors.child && <Text c="red" size="sm" mt="xs">{fieldErrors.child}</Text>}
        {fieldErrors.childDob && <Text c="red" size="sm" mt="xs">{fieldErrors.childDob}</Text>}
      </section>

      <section>
        <Title order={5} mb="sm">About you</Title>
        <TextInput
          label="Your full name"
          value={primaryName}
          error={fieldErrors.primaryName}
          onChange={(e) => { setPrimaryName(e.currentTarget.value); clearErr("primaryName"); }}
        />
        <TextInput mt="sm" label="Allergies (optional)" value={primaryAllergies} onChange={(e) => setPrimaryAllergies(e.currentTarget.value)} />
      </section>

      <section>
        <Title order={5} mb="sm">Emergency contact</Title>
        <EmergencyContactForm
          emName={emName} setEmName={setEmName}
          emPhone={emPhone} setEmPhone={setEmPhone}
          emEmail={emEmail} setEmEmail={setEmEmail}
          errors={fieldErrors}
          clearErr={clearErr}
        />
      </section>

      <section>
        <Title order={5} mb="sm">Home address (optional)</Title>
        <AddressForm address={address} onChange={setAddress} onErrorClear={() => {}} />
      </section>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      <Button size="md" onClick={save} loading={saving} disabled={saving}>Save &amp; continue to enroll</Button>
    </Stack>
  );
}
