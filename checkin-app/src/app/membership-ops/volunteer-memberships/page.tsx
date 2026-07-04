"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Card, Center, Group, Loader, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { AlertBanner } from "@/components/admin/AlertBanner";
import { notifications } from "@mantine/notifications";

interface Designation {
  id: number;
  email: string;
  createdAt: string;
}

export default function VolunteerMembershipsPage() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const flash = (m: string) => setMessage(m);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/membership/volunteer-designations");
      if (res.ok) setDesignations((await res.json()).designations || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addDesignation = async () => {
    if (!newEmail.trim()) return;
    setSaving(true);
    flash("");
    try {
      const res = await fetch("/api/settings/membership/volunteer-designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewEmail("");
        if (data.warning) { flash(data.warning); } else { notifications.show({ color: "green", message: "Designation added." }); }
        await load();
      } else flash(data.error || "Could not add.");
    } catch { flash("Network error."); }
    finally { setSaving(false); }
  };

  const removeDesignation = async (id: number) => {
    setSaving(true);
    try {
      await fetch(`/api/settings/membership/volunteer-designations?id=${id}`, { method: "DELETE" });
      await load();
    } finally { setSaving(false); }
  };

  return (
    <Stack>
      <AlertBanner message={message} tone="warning" />

      <Card withBorder radius="md" padding="lg">
        <Title order={3} mb="xs">Volunteer-only designated emails</Title>
        <Text c="dimmed" mb="md">
          If one of these emails applies for membership, that whole household is treated as a
          volunteer only family (lower dues).
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
        {loading ? (
          <Center py="xl"><Loader /></Center>
        ) : designations.length === 0 ? (
          <Text c="dimmed">No volunteer designations yet.</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Email</Table.Th>
                <Table.Th w={120}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {designations.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>{d.email}</Table.Td>
                  <Table.Td>
                    <Button variant="subtle" color="red" size="compact-sm" disabled={saving} onClick={() => removeDesignation(d.id)}>
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
