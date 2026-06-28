"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Center, Code, Group, Loader, Stack, Text } from "@mantine/core";

type AuditLog = {
  id: number;
  time: string;
  actorId: number;
  action: "CREATE" | "EDIT" | "DELETE" | "BECOME_ADMIN";
  tableName: string;
  affectedEntityId: number;
  secondaryAffectedEntity: number | null;
  oldData: unknown;
  newData: unknown;
};

const ACTION_COLOR: Record<AuditLog["action"], string> = {
  CREATE: "green",
  EDIT: "blue",
  DELETE: "red",
  BECOME_ADMIN: "grape",
};

export function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/audit")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setLogs(data.logs))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <Text c="red">Failed to load audit log.</Text>;
  if (!logs) {
    return (
      <Center mih="30vh">
        <Loader />
      </Center>
    );
  }

  if (logs.length === 0) {
    return (
      <Card withBorder radius="md" padding="lg">
        <Text c="dimmed">No audit entries logged yet.</Text>
      </Card>
    );
  }

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        100 most recent changes. Forensic trail — read-only.
      </Text>
      {logs.map((l) => (
        <Card key={l.id} withBorder radius="md" padding="md">
          <Group gap="xs" mb={4}>
            <Badge color={ACTION_COLOR[l.action]}>{l.action}</Badge>
            <Text size="sm" fw={600}>
              {l.tableName} #{l.affectedEntityId}
            </Text>
            <Text size="xs" c="dimmed">
              actor #{l.actorId} · {new Date(l.time).toLocaleString()}
            </Text>
          </Group>
          {(l.oldData != null || l.newData != null) && (
            <Code block fz="xs">
              {JSON.stringify({ old: l.oldData, new: l.newData }, null, 2)}
            </Code>
          )}
        </Card>
      ))}
    </Stack>
  );
}
