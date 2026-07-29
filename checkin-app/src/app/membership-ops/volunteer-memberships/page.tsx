"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Badge, Button, Card, Chip, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { AlertBanner } from "@/components/admin/AlertBanner";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { useRequireRole } from "@/hooks/useRequireRole";
import { PageLoader } from "@/components/ui/PageLoader";
import { notifications } from "@mantine/notifications";
import { isValidEmail } from "@/lib/emergencyContacts/identity";
import type { VolunteerRow, VolunteerRowStatus } from "@/app/api/membership-ops/volunteer-memberships/route";

const STATUS_CHIPS: { value: VolunteerRowStatus; label: string; color: string }[] = [
  { value: "VOLUNTEER", label: "Volunteer member", color: "green" },
  { value: "IN_PROGRESS", label: "Signup in progress", color: "blue" },
  { value: "DESIGNATED", label: "Pre-designated", color: "gray" },
  { value: "FULL_PRICE", label: "Full-price member", color: "yellow" },
  { value: "REVOKED", label: "Revoked", color: "red" },
];

const chipFor = (status: VolunteerRowStatus) => STATUS_CHIPS.find((c) => c.value === status);

// Sort order for the Status column: most-settled first, so the roster reads
// active volunteers → in-flight → not-yet-members.
const STATUS_RANK = Object.fromEntries(STATUS_CHIPS.map((c, i) => [c.value, i]));

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—";

export default function VolunteerMembershipsPage() {
  const { ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);
  const [rows, setRows] = useState<VolunteerRow[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "warning" | "error" } | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);

  const flash = (text: string, tone: "warning" | "error" = "error") =>
    setMessage(text ? { text, tone } : undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/membership-ops/volunteer-memberships");
      if (!res.ok) throw new Error(String(res.status));
      setRows((await res.json()).rows || []);
      setLoadFailed(false);
    } catch {
      // Without this the failed load is indistinguishable from an empty roster.
      setRows([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statuses.length > 0 && !statuses.includes(r.status)) return false;
      if (!q) return true;
      return [r.householdName, r.email, ...r.leads].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, search, statuses]);

  if (authLoading) {
    return <PageLoader />;
  }

  if (!ready) {
    return null;
  }

  const addDesignation = async () => {
    setEmailError(undefined);
    if (!newEmail.trim()) return;
    if (!isValidEmail(newEmail)) { setEmailError("A valid email is required."); return; }
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/settings/membership/volunteer-designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewEmail("");
        if (data.warning) { flash(data.warning, "warning"); } else { notifications.show({ message: "Designation added." }); }
        await load();
      } else flash(data.error || "Could not add.");
    } catch { notifications.show({ color: "red", message: "Network error.", autoClose: false }); }
    finally { setSaving(false); }
  };

  const removeDesignation = async (id: number) => {
    setSaving(true);
    try {
      await fetch(`/api/settings/membership/volunteer-designations?id=${id}`, { method: "DELETE" });
      await load();
    } finally { setSaving(false); }
  };

  const columns: DataTableColumn<VolunteerRow>[] = [
    {
      header: "Household",
      sortBy: (r) => r.householdName,
      render: (r) =>
        r.householdName ?? <Text c="dimmed" fs="italic">Not signed up yet</Text>,
    },
    {
      header: "Lead(s)",
      sortBy: (r) => r.leads[0],
      render: (r) => (r.leads.length ? r.leads.join(", ") : "—"),
    },
    { header: "Email", sortBy: (r) => r.email, render: (r) => r.email ?? "—" },
    {
      header: "Status",
      sortBy: (r) => STATUS_RANK[r.status],
      render: (r) => {
        const chip = chipFor(r.status);
        return <Badge color={chip?.color} variant="light">{chip?.label ?? r.status}</Badge>;
      },
    },
    { header: "Member since", sortBy: (r) => r.memberSince, render: (r) => formatDate(r.memberSince) },
    { header: "Designated", sortBy: (r) => r.designatedAt, render: (r) => formatDate(r.designatedAt) },
    {
      header: "",
      align: "right",
      render: (r) =>
        r.designationId != null ? (
          <Button
            variant="subtle"
            color="red"
            size="compact-sm"
            disabled={saving}
            onClick={() => removeDesignation(r.designationId!)}
          >
            Remove
          </Button>
        ) : null,
    },
  ];

  return (
    <Stack>
      <AlertBanner message={message?.text} tone={message?.tone} />
      {loadFailed && (
        <AlertBanner message="Could not load the volunteer roster. Refresh to try again." tone="error" />
      )}

      <Card withBorder radius="md" padding="lg">
        <Title order={3} mb="xs">Volunteers</Title>
        <Text c="dimmed" mb="md">
          Households on volunteer-only dues, plus emails designated ahead of signup — when one of
          those emails applies for membership, that whole household is treated as volunteer only.
        </Text>

        <Group gap="sm" wrap="wrap" mb="md" align="flex-end">
          <TextInput
            w={280}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search household, lead, or email"
            aria-label="Search volunteers"
          />
          <Chip.Group multiple value={statuses} onChange={setStatuses}>
            <Group gap="xs">
              {STATUS_CHIPS.map((c) => (
                <Chip key={c.value} value={c.value} color={c.color} size="sm" variant="outline">
                  {c.label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Group>

        <DataTable
          columns={columns}
          rows={visibleRows}
          getRowKey={(r) => r.key}
          loading={loading}
          minWidth={900}
          emptyMessage={
            loadFailed
              ? "Roster unavailable."
              : rows.length === 0
                ? "No volunteers or designations yet."
                : "No volunteers match this filter."
          }
        />
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={4} mb="xs">Designate a volunteer email</Title>
        <Group gap="sm" wrap="wrap" align="flex-end">
          <TextInput
            w={320}
            value={newEmail}
            onChange={(e) => { setNewEmail(e.currentTarget.value); setEmailError(undefined); }}
            error={emailError}
            placeholder="volunteer@example.com"
            aria-label="Volunteer email"
          />
          <Button disabled={saving} onClick={addDesignation}>Add</Button>
        </Group>
      </Card>
    </Stack>
  );
}
