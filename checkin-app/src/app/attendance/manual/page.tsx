"use client";

import { useState } from "react";
import { Alert, Button, Card, Center, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import { PageContainer } from "@/components/ui/PageContainer";
import { useRequireRole } from "@/hooks/useRequireRole";
import { AttendanceTabs } from "../AttendanceTabs";

export default function ManualAttendance() {
  const { ready, loading: authLoading } = useRequireRole([]);
  const [arrived, setArrived] = useState("");
  const [departed, setDeparted] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arrived, departed }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record manual visit.");
      } else {
        setSuccess("Visit recorded successfully.");
        setArrived("");
        setDeparted("");
      }
    } catch {
      setError("Network error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <Center mih="60vh"><Loader /></Center>;
  if (!ready) return null;

  return (
    <PageContainer>
      <AttendanceTabs />
      <Card withBorder radius="md" padding="lg">
        <Title order={1} mb="md">Manual Time Entry</Title>

        <Text c="dimmed" mb="lg">
          Forgot to scan your badge? You can self-correct your time record here. If you are
          currently in the building, leave the departure time blank.
        </Text>

        {error && <Alert color="red" mb="md">{error}</Alert>}
        {success && <Alert color="green" mb="md">{success}</Alert>}

        <form onSubmit={handleSubmit}>
          <Stack>
            <TextInput
              type="datetime-local"
              label="Arrival Time (Required)"
              value={arrived}
              onChange={(e) => setArrived(e.currentTarget.value)}
              required
            />
            <TextInput
              type="datetime-local"
              label="Departure Time (Optional)"
              value={departed}
              onChange={(e) => setDeparted(e.currentTarget.value)}
            />
            <Button type="submit" disabled={loading || !arrived} loading={loading} mt="sm">
              Record Time Entry
            </Button>
          </Stack>
        </form>
      </Card>
    </PageContainer>
  );
}
