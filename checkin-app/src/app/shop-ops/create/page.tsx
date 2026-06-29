"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Flex, ScrollArea, Stack, Text, TextInput } from "@mantine/core";

type ToolListItem = {
  id: number;
  name: string;
  safetyGuide: string | null;
  _count?: { toolStatuses: number };
};

export default function CreateToolPage() {
  const [newToolName, setNewToolName] = useState("");
  const [newToolGuide, setNewToolGuide] = useState("");
  const [saving, setSaving] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [tools, setTools] = useState<ToolListItem[]>([]);

  const loadTools = useCallback(async () => {
    const res = await fetch("/api/shop/tools");
    if (res.ok) setTools(await res.json());
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

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
        loadTools();
      } else {
        const data = await res.json();
        setCreateMessage(data.error || "Failed to create tool.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex gap="lg" align="flex-start" wrap="wrap">
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

      <Card withBorder radius="md" padding="md" w={260}>
        <Text fw={600} size="sm" mb="xs">Existing tools</Text>
        <ScrollArea.Autosize mah={420} type="auto">
          <Stack gap={4}>
            {tools.map((t) => (
              <Text key={t.id} size="sm">{t.name}</Text>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Card>
    </Flex>
  );
}
