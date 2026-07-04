"use client";

import { useState } from "react";
import { Alert, Button, Card, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { PageContainer } from "@/components/ui/PageContainer";
import { useRequireRole } from "@/hooks/useRequireRole";
import { notifyNavRefresh } from "@/lib/nav-refresh";
import { AttendanceTabs } from "../AttendanceTabs";

import { PageLoader } from "@/components/ui/PageLoader";
export default function ManualAttendance() {
  const { ready, loading: authLoading } = useRequireRole([]);
  const [arrivedAt, setArrived] = useState("");
  const [departedAt, setDeparted] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arrivedAt, departedAt }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record manual visit.");
      } else {
        notifications.show({ color: "green", message: "Visit recorded successfully." });
        setArrived("");
        setDeparted("");
        // Building occupancy badges (attendance nav) count this new visit — refresh them.
        notifyNavRefresh();
      }
    } catch {
      setError("Network error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <PageLoader />;
  if (!ready) return null;

  const departureError = error === "Departure time is required for past arrivals.";

  return (
    <PageContainer>
      <AttendanceTabs />
      <Card withBorder radius="md" padding="lg">
        <Title order={1} mb="md">Manual Time Entry</Title>

        <Text c="dimmed" mb="lg">
          Forgot to scan your badge? You can self-correct your time record here. If you are
          currently in the building, leave the departure time blank.
        </Text>

        {error && !departureError && <Alert color="red" mb="md">{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <Stack>
            <TextInput
              type="datetime-local"
              label="Arrival Time (Required)"
              value={arrivedAt}
              onChange={(e) => setArrived(e.currentTarget.value)}
              required
            />
            <TextInput
              type="datetime-local"
              label="Departure Time (Optional)"
              value={departedAt}
              onChange={(e) => setDeparted(e.currentTarget.value)}
              error={departureError ? error : undefined}
            />
            <Button type="submit" disabled={loading || !arrivedAt} loading={loading} mt="sm">
              Record Time Entry
            </Button>
          </Stack>
        </form>
      </Card>
    </PageContainer>
  );
}
