"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Divider, Group, Loader, Modal, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { pickAddress, type StructuredAddress } from "@/lib/address";
import { isValidPhone, PHONE_ERROR } from "@/lib/phone";

export type AdminHousehold = {
  id: number;
  name: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  householdMembers?: Array<{ id: number; name: string | null; email: string | null }>;
  householdLeads?: Array<{ personId: number }>;
  orgMembership?: { memberSince: string | null } | null;
} & Partial<StructuredAddress>;

type FormState = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  memberSince: string;
};

const EMPTY: FormState = { name: "", line1: "", line2: "", city: "", state: "", postalCode: "", emergencyContactName: "", emergencyContactPhone: "", memberSince: "" };

/** Deep-compares flat string form state. Exported for unit test. */
export function isFormDirty(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Admin/board editor for a household's own info. Denser than the member-facing
 * `/my-household` editor and reachable from any admin surface that has a household id.
 *
 * Saving is intentionally two-step: the form gates behind an "are you using admin
 * powers" confirmation dialog — not a data-confirmation, but an acknowledgement
 * that you're editing a household you don't belong to (the edit is also audited).
 */
export function AdminEditHouseholdModal({
  householdId,
  opened,
  onClose,
  onSaved,
}: {
  householdId: number | null;
  opened: boolean;
  onClose: () => void;
  onSaved?: (household: AdminHousehold) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [displayName, setDisplayName] = useState("");
  const [members, setMembers] = useState<NonNullable<AdminHousehold["householdMembers"]>>([]);
  const [leadIds, setLeadIds] = useState<number[]>([]);
  const [removingLead, setRemovingLead] = useState<number | null>(null);

  const loadHousehold = useCallback(async (signal?: { cancelled: boolean }) => {
    if (householdId == null) return;
    try {
      const res = await fetch(`/api/membership-ops/households?id=${householdId}`);
      const data = await res.json();
      const h: AdminHousehold | null = data.household;
      if (signal?.cancelled) return;
      if (h) {
        const a = pickAddress(h);
        const loaded: FormState = {
          name: h.name || "",
          line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "",
          emergencyContactName: h.emergencyContactName || "",
          emergencyContactPhone: h.emergencyContactPhone || "",
          // date-only slice of the membership's join date (ISO → YYYY-MM-DD)
          memberSince: h.orgMembership?.memberSince ? h.orgMembership.memberSince.slice(0, 10) : "",
        };
        setForm(loaded);
        setInitial(loaded);
        setDisplayName(h.name || `Household #${h.id}`);
        setMembers(h.householdMembers ?? []);
        setLeadIds((h.householdLeads ?? []).map((l) => l.personId));
      }
    } catch {
      notifications.show({ color: "red", message: "Failed to load household.", autoClose: false });
    }
  }, [householdId]);

  useEffect(() => {
    if (!opened || householdId == null) return;
    const signal = { cancelled: false };
    setLoading(true);
    loadHousehold(signal).finally(() => {
      if (!signal.cancelled) setLoading(false);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [opened, householdId, loadHousehold]);

  const handleRemoveLead = async (participantId: number) => {
    if (leadIds.length <= 1) return; // last-lead guard also enforced server-side
    setRemovingLead(participantId);
    try {
      const res = await fetch(`/api/household/lead`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (res.ok) {
        notifications.show({ color: "green", message: "Lead removed." });
        await loadHousehold();
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: "red", message: data.error || "Failed to remove lead.", autoClose: false });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
    } finally {
      setRemovingLead(null);
    }
  };

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Gate every dismiss path (X, backdrop, escape, Cancel) behind a discard
  // prompt when the form has unsaved edits. handleSave calls onClose directly
  // so a successful save never prompts.
  const requestClose = () => {
    if (isFormDirty(form, initial) && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  // Phone is optional here, so only a non-empty malformed value is an error.
  const phoneInvalid = form.emergencyContactPhone.trim() !== "" && !isValidPhone(form.emergencyContactPhone);

  const handleSave = async () => {
    if (householdId == null || phoneInvalid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/membership-ops/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        notifications.show({ color: "green", message: "Household updated." });
        onSaved?.(data.household);
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: "red", message: data.error || "Failed to update household.", autoClose: false });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error.", autoClose: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={requestClose}
        size="lg"
        title={<Text fw={600} size="lg">Edit Household Info{displayName ? ` — ${displayName}` : ""}</Text>}
      >
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : (
          <Stack>
            <Text size="sm" c="dimmed">
              Admin view — edits apply to the whole household and are recorded in the audit log.
            </Text>
            <TextInput
              label="Household Name"
              value={form.name}
              onChange={(e) => update({ name: e.currentTarget.value })}
              placeholder="The Smith Family"
            />
            <TextInput
              label="Street Address"
              value={form.line1}
              onChange={(e) => update({ line1: e.currentTarget.value })}
              placeholder="123 Main St"
            />
            <TextInput
              label="Apt / Suite (optional)"
              value={form.line2}
              onChange={(e) => update({ line2: e.currentTarget.value })}
              placeholder="Apt 4B"
            />
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label="City" value={form.city} onChange={(e) => update({ city: e.currentTarget.value })} />
              <TextInput label="State" maxLength={2} value={form.state} onChange={(e) => update({ state: e.currentTarget.value })} placeholder="TX" />
              <TextInput label="ZIP" value={form.postalCode} onChange={(e) => update({ postalCode: e.currentTarget.value })} placeholder="78701" />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Emergency Contact Name"
                value={form.emergencyContactName}
                onChange={(e) => update({ emergencyContactName: e.currentTarget.value })}
                placeholder="Full Name"
              />
              <TextInput
                type="tel"
                label="Emergency Contact Phone"
                value={form.emergencyContactPhone}
                onChange={(e) => update({ emergencyContactPhone: e.currentTarget.value })}
                placeholder="(555) 555-5555"
                error={phoneInvalid ? PHONE_ERROR : undefined}
              />
            </SimpleGrid>
            <TextInput
              type="date"
              label="Member since"
              description="Household's membership start date. Editing this is recorded in the audit log."
              value={form.memberSince}
              onChange={(e) => update({ memberSince: e.currentTarget.value })}
            />
            <Divider label="Household Leads" labelPosition="left" mt="sm" />
            <Stack gap="xs">
              {leadIds.length === 0 && (
                <Text size="sm" c="dimmed">No leads on this household.</Text>
              )}
              {members
                .filter((m) => leadIds.includes(m.id))
                .map((m) => (
                  <Group key={m.id} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm">{m.name || `#${m.id}`}</Text>
                      {m.email && <Text size="xs" c="dimmed">{m.email}</Text>}
                    </div>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      loading={removingLead === m.id}
                      disabled={leadIds.length <= 1}
                      title={leadIds.length <= 1 ? "Can't remove the last lead" : undefined}
                      onClick={() => handleRemoveLead(m.id)}
                    >
                      Remove lead
                    </Button>
                  </Group>
                ))}
              {leadIds.length === 1 && (
                <Text size="xs" c="dimmed">A household must keep at least one lead.</Text>
              )}
            </Stack>

            <Alert color="orange" mt="md">
              You&apos;re editing <strong>{displayName}</strong>, a household you&apos;re not a member of. This
              uses your administrative privileges and is recorded in the audit log.
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button color="orange" onClick={handleSave} loading={saving} disabled={phoneInvalid}>
                Save Changes — As Admin
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
