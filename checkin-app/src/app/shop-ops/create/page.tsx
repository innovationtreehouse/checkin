"use client";

import { useState } from "react";
import { Alert, Button, Card, Stack, Text, TextInput } from "@mantine/core";

export default function CreateToolPage() {
  const [newToolName, setNewToolName] = useState("");
  const [newToolGuide, setNewToolGuide] = useState("");
  const [saving, setSaving] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setCreateMessage("");

    try {
      const res = await fetch("/api/shop/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newToolName, safetyGuide: newToolGuide }),
      });

      if (res.ok) {
        setCreateMessage("New tool added successfully!");
        setNewToolName("");
        setNewToolGuide("");
      } else {
        const data = await res.json();
        setCreateMessage(data.error || "Failed to create tool.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder radius="md" padding="lg" maw={520}>
      <Text c="dimmed" mb="lg">
        Define a new piece of shop equipment to begin tracking safety certifications,
        authorizing Certifiers, and tracking usage.
      </Text>

      {createMessage && (
        <Alert color={createMessage.includes("success") ? "green" : "red"} mb="md">{createMessage}</Alert>
      )}

      <form onSubmit={handleCreateTool}>
        <Stack>
          <TextInput
            label="Equipment Name"
            required
            placeholder="e.g. Table Saw"
            value={newToolName}
            onChange={(e) => setNewToolName(e.currentTarget.value)}
          />
          <TextInput
            type="url"
            label="Safety Guide URL"
            placeholder="https://example.com/safety-manual"
            description="Optional link to the required reading or manufacturer manual."
            value={newToolGuide}
            onChange={(e) => setNewToolGuide(e.currentTarget.value)}
          />
          <Button type="submit" disabled={saving} loading={saving} mt="sm" style={{ alignSelf: "flex-start" }}>
            Create Tool
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
