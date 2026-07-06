"use client";

import { useState, useEffect, useCallback } from "react";
import { Alert, Button, Card, Center, Checkbox, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { SettingsTabs } from "@/components/admin/SettingsTabs";
import { useUnsavedGuard, shallowEqual } from "@/components/UnsavedChangesProvider";

interface Settings {
  emailFromAddress: string | null;
  emailReplyToAddress: string | null;
}

export default function EmailSettingsPage() {
  const [emailFrom, setEmailFrom] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  // Once an identity exists, editing is high-stakes (a wrong From on an unverified
  // domain bounces all mail; a wrong Reply-To misroutes replies) — lock behind an
  // explicit unlock, mirroring the membership-year boundary. First-time set is free.
  const [unlocked, setUnlocked] = useState(false);

  const [initial, setInitial] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ text: string; err: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/email");
      if (res.ok) {
        const { settings } = (await res.json()) as { settings: Settings };
        const snap = { emailFrom: settings.emailFromAddress ?? "", emailReplyTo: settings.emailReplyToAddress ?? "" };
        setEmailFrom(snap.emailFrom);
        setEmailReplyTo(snap.emailReplyTo);
        setInitial(snap);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const wasSet = !!(initial?.emailFrom || initial?.emailReplyTo);
  const locked = wasSet && !unlocked;

  const save = async () => {
    setSaveNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailFromAddress: emailFrom.trim() || null, emailReplyToAddress: emailReplyTo.trim() || null }),
      });
      if (res.ok) { notifications.show({ color: "green", message: "Email settings saved." }); setUnlocked(false); await load(); }
      else { const d = await res.json().catch(() => ({})); setSaveNotice({ text: d.error || "Save failed.", err: true }); }
    } catch { notifications.show({ color: "red", message: "Network error.", autoClose: false }); }
    finally { setSaving(false); }
  };

  const isDirty = !!initial && !shallowEqual(initial, { emailFrom, emailReplyTo });
  useUnsavedGuard(isDirty);

  return (
    <Stack>
      <SettingsTabs active="email" />

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <Card withBorder radius="md" padding="lg">
          <Title order={3} mb="xs">Email sender identity</Title>
          <Text size="sm" c="dimmed" mb="md">
            Controls the sender on <strong>every</strong> outbound email (check-in receipts, membership
            notices, board alerts). Leave blank to use the environment default sender.
          </Text>

          <Alert color={wasSet ? "yellow" : "blue"} variant="light" mb="md">
            {wasSet ? (
              <Text size="sm">
                ⚠️ The <strong>From</strong> address must be on a domain verified in Resend or all mail
                bounces. Changing these affects every outbound email — only edit if you are sure.
              </Text>
            ) : (
              <Text size="sm">
                The <strong>From</strong> address must be on a domain verified in Resend.{" "}
                <strong>Reply-To</strong> can be any address (e.g. a real board inbox) so replies to a
                no-reply sender reach someone.
              </Text>
            )}
          </Alert>

          {wasSet && (
            <Checkbox
              mb="md"
              checked={unlocked}
              onChange={(e) => setUnlocked(e.currentTarget.checked)}
              label="I understand — let me edit the sender addresses"
            />
          )}

          <Stack gap="md">
            <TextInput
              label="From address"
              description={'Bare address or "Name <addr@domain>". Blank = environment default.'}
              placeholder="Innovation Treehouse <noreply@updates.innovationtreehouse.org>"
              w={440}
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.currentTarget.value)}
              disabled={locked}
            />
            <TextInput
              label="Reply-To address"
              description="Where replies go. Blank = replies go to the From address."
              placeholder="board@innovationtreehouse.org"
              w={440}
              value={emailReplyTo}
              onChange={(e) => setEmailReplyTo(e.currentTarget.value)}
              disabled={locked}
            />
          </Stack>

          {saveNotice && (
            <Alert mt="lg" color={saveNotice.err ? "red" : "green"} variant="light">
              {saveNotice.text}
            </Alert>
          )}

          <Button mt="lg" disabled={saving || locked} loading={saving} onClick={save} style={{ alignSelf: "flex-start" }}>
            Save settings
          </Button>
        </Card>
      )}
    </Stack>
  );
}
