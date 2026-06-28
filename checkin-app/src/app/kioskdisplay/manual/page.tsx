"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Container, Group, Stack, Text, TextInput, Title } from "@mantine/core";

export default function ManualAttendance() {
  const router = useRouter();
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

  return (
    <Container size="sm" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="md">
          <Title order={1}>Manual Time Entry</Title>
          <Button variant="default" onClick={() => router.push("/kioskdisplay")}>
            ← Back to Attendance
          </Button>
        </Group>

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
    </Container>
  );
}
