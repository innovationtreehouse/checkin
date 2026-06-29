"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";

export type AdminHousehold = {
  id: number;
  name: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

type FormState = {
  name: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

const EMPTY: FormState = { name: "", address: "", emergencyContactName: "", emergencyContactPhone: "" };

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
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (!opened || householdId == null) return;
    let cancelled = false;
    setLoading(true);
    setConfirming(false);
    (async () => {
      try {
        const res = await fetch(`/api/admin/households?id=${householdId}`);
        const data = await res.json();
        const h: AdminHousehold | null = data.household;
        if (cancelled) return;
        if (h) {
          setForm({
            name: h.name || "",
            address: h.address || "",
            emergencyContactName: h.emergencyContactName || "",
            emergencyContactPhone: h.emergencyContactPhone || "",
          });
          setDisplayName(h.name || `Household #${h.id}`);
        }
      } catch {
        notifications.show({ color: "red", message: "Failed to load household." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, householdId]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = async () => {
    if (householdId == null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        notifications.show({ color: "green", message: "Household updated." });
        onSaved?.(data.household);
        setConfirming(false);
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        notifications.show({ color: "red", message: data.error || "Failed to update household." });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        size="lg"
        title={<Title order={4}>Edit Household Info{displayName ? ` — ${displayName}` : ""}</Title>}
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
              label="Primary Address"
              value={form.address}
              onChange={(e) => update({ address: e.currentTarget.value })}
              placeholder="123 Main St, City, ST 12345"
            />
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
              />
            </SimpleGrid>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button color="green" onClick={() => setConfirming(true)}>
                Save Changes
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        zIndex={1100}
        title={<Title order={5}>Use admin powers?</Title>}
      >
        <Alert color="orange" mb="md">
          You&apos;re editing <strong>{displayName}</strong>, a household you&apos;re not a member of. This
          uses your administrative privileges and is recorded in the audit log.
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirming(false)} disabled={saving}>
            Cancel
          </Button>
          <Button color="orange" onClick={handleSave} loading={saving}>
            Yes, save changes
          </Button>
        </Group>
      </Modal>
    </>
  );
}
