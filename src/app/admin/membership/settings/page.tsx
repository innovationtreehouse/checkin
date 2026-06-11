"use client";

import { useState, useEffect, useCallback } from "react";
import { Alert, Button, Card, Center, Checkbox, Group, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

interface Settings {
  normalDuesCents: number;
  volunteerDuesCents: number;
  membershipYearBoundary: string | null;
}
interface Designation {
  id: number;
  email: string;
  createdAt: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export default function MembershipSettingsPage() {
  const [normalDues, setNormalDues] = useState("0");
  const [volunteerDues, setVolunteerDues] = useState("0");
  const [boundary, setBoundary] = useState("");
  const [boundaryUnlocked, setBoundaryUnlocked] = useState(false);

  const [designations, setDesignations] = useState<Designation[]>([]);
  const [newEmail, setNewEmail] = useState("");

  const [bulkReminders, setBulkReminders] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const flash = (m: string, err = false) => { setMessage(m); setIsError(err); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, dRes] = await Promise.all([
        fetch("/api/admin/membership/settings"),
        fetch("/api/admin/membership/volunteer-designations"),
      ]);
      if (sRes.ok) {
        const { settings } = (await sRes.json()) as { settings: Settings };
        setNormalDues(dollars(settings.normalDuesCents));
        setVolunteerDues(dollars(settings.volunteerDuesCents));
        setBoundary(settings.membershipYearBoundary ? settings.membershipYearBoundary.slice(0, 10) : "");
      }
      if (dRes.ok) setDesignations((await dRes.json()).designations || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/admin/membership/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalDuesCents: Math.round(parseFloat(normalDues || "0") * 100),
          volunteerDuesCents: Math.round(parseFloat(volunteerDues || "0") * 100),
          ...(boundaryUnlocked ? { membershipYearBoundary: boundary || null } : {}),
        }),
      });
      if (res.ok) { flash("Settings saved."); setBoundaryUnlocked(false); await load(); }
      else flash((await res.json()).error || "Save failed.", true);
    } catch { flash("Network error.", true); }
    finally { setSaving(false); }
  };

  const addDesignation = async () => {
    if (!newEmail.trim()) return;
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/admin/membership/volunteer-designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewEmail("");
        flash(data.warning || "Designation added.", !!data.warning);
        await load();
      } else flash(data.error || "Could not add.", true);
    } catch { flash("Network error.", true); }
    finally { setSaving(false); }
  };

  const removeDesignation = async (id: number) => {
    setSaving(true);
    try {
      await fetch(`/api/admin/membership/volunteer-designations?id=${id}`, { method: "DELETE" });
      await load();
    } finally { setSaving(false); }
  };

  const bulkOpenRenewals = async () => {
    if (!confirm("Open a renewal cycle for ALL active members now? This is a one-time go-live action.")) return;
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/admin/membership/bulk-open-renewals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendReminders: bulkReminders }),
      });
      const data = await res.json();
      if (res.ok) flash(`Opened ${data.opened} renewal(s); ${data.skipped} already in progress.`);
      else flash(data.error || "Failed.", true);
    } catch { flash("Network error.", true); }
    finally { setSaving(false); }
  };

  return (
    <Stack maw={820} mx="auto">
      <AdminPageHeader title="Membership Settings" back={{ href: '/admin/membership', label: '← Applications' }} />

      {message && <Alert color={isError ? "yellow" : "green"}>{message}</Alert>}

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <>
          <Card withBorder radius="md" padding="lg">
            <Title order={3} mb="md">Dues &amp; configuration</Title>
            <Group align="flex-end" gap="lg" wrap="wrap">
              <TextInput
                label="Annual dues (normal)"
                leftSection="$"
                inputMode="decimal"
                w={160}
                value={normalDues}
                onChange={(e) => setNormalDues(e.currentTarget.value)}
              />
              <TextInput
                label="Annual dues (volunteer)"
                leftSection="$"
                inputMode="decimal"
                w={160}
                value={volunteerDues}
                onChange={(e) => setVolunteerDues(e.currentTarget.value)}
              />
            </Group>

            <Alert color="yellow" variant="light" mt="md">
              ⚠️ These amounts only set what applicants <strong>see</strong> in the membership
              process. They do <strong>not</strong> change what members are actually charged — the
              matching Shopify variant prices must be updated separately.
            </Alert>

            <Alert color="yellow" variant="light" mt="md" title="Membership-year boundary">
              <Text size="sm" mb="sm">
                ⚠️ Changing this date shifts the renewal cycle for <strong>every household</strong>.
                Only change it if you are sure.
              </Text>
              <Checkbox
                mb="sm"
                checked={boundaryUnlocked}
                onChange={(e) => setBoundaryUnlocked(e.currentTarget.checked)}
                label="I understand — let me edit the boundary date"
              />
              <TextInput
                type="date"
                w={220}
                value={boundary}
                onChange={(e) => setBoundary(e.currentTarget.value)}
                disabled={!boundaryUnlocked}
              />
            </Alert>

            <Button mt="lg" disabled={saving} loading={saving} onClick={saveSettings} style={{ alignSelf: "flex-start" }}>
              Save settings
            </Button>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Title order={3} mb="xs">Volunteer-designated emails</Title>
            <Text c="dimmed" mb="md">
              If one of these emails applies for membership, that whole household is treated as a
              volunteer family (lower dues).
            </Text>
            <Group gap="sm" wrap="wrap" mb="md" align="flex-end">
              <TextInput
                w={320}
                value={newEmail}
                onChange={(e) => setNewEmail(e.currentTarget.value)}
                placeholder="volunteer@example.com"
              />
              <Button disabled={saving} onClick={addDesignation}>Add</Button>
            </Group>
            {designations.length === 0 ? (
              <Text c="dimmed">No volunteer designations yet.</Text>
            ) : (
              <Stack gap={0}>
                {designations.map((d) => (
                  <Group key={d.id} justify="space-between" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                    <span>{d.email}</span>
                    <Button variant="subtle" color="red" size="compact-sm" disabled={saving} onClick={() => removeDesignation(d.id)}>
                      Remove
                    </Button>
                  </Group>
                ))}
              </Stack>
            )}
          </Card>

          <Card withBorder radius="md" padding="lg" style={{ borderColor: "var(--mantine-color-yellow-5)" }}>
            <Title order={3} mb="xs">Go-live: open renewals</Title>
            <Text c="yellow.7" size="sm">
              ⚠️ One-time go-live action. Opens a renewal cycle for <strong>every active member</strong> so
              they renew for the upcoming year. Press this once, after your existing members are
              imported (board or sysadmin).
            </Text>
            <Checkbox
              my="sm"
              checked={bulkReminders}
              onChange={(e) => setBulkReminders(e.currentTarget.checked)}
              label="Also email each household a renewal reminder"
            />
            <Button color="yellow" disabled={saving} loading={saving} onClick={bulkOpenRenewals}>
              Open renewals for all active members
            </Button>
          </Card>
        </>
      )}
    </Stack>
  );
}
