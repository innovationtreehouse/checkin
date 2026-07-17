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
  const [fieldErrors, setFieldErrors] = useState<{ arrivedAt?: string; departedAt?: string }>({});

  const validateTimes = () => {
    const now = Date.now();
    const fe: { arrivedAt?: string; departedAt?: string } = {};
    const arr = new Date(arrivedAt);
    if (!arrivedAt) fe.arrivedAt = "Arrival time is required";
    else if (isNaN(arr.getTime())) fe.arrivedAt = "Invalid arrival time";
    else if (arr.getTime() > now + 5 * 60 * 1000) fe.arrivedAt = "Arrival time cannot be in the future.";
    if (departedAt) {
      const dep = new Date(departedAt);
      if (isNaN(dep.getTime())) fe.departedAt = "Invalid departure time";
      else if (dep.getTime() <= arr.getTime()) fe.departedAt = "Departure time must be after arrival time";
      else if (dep.getTime() - arr.getTime() > 24 * 60 * 60 * 1000) fe.departedAt = "A visit cannot be longer than 24 hours.";
    } else if (arrivedAt && !fe.arrivedAt) {
      const withinSixHours = now - arr.getTime() <= 6 * 60 * 60 * 1000;
      const sameDay = arr.toDateString() === new Date(now).toDateString();
      if (!withinSixHours && !sameDay) fe.departedAt = "Departure time is required for past arrivals.";
    }
    return fe;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const fe = validateTimes();
    if (fe.arrivedAt || fe.departedAt) {
      setFieldErrors(fe);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // datetime-local gives a naive "YYYY-MM-DDTHH:mm" (no offset). Send a real
        // instant so the server doesn't reparse it in ITS timezone (UTC in prod).
        body: JSON.stringify({
          arrivedAt: new Date(arrivedAt).toISOString(),
          departedAt: departedAt ? new Date(departedAt).toISOString() : "",
        }),
      });

      const data = await res.json().catch(() => ({}));
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
      notifications.show({ color: "red", message: "Network error occurred.", autoClose: false });
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <PageLoader />;
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

        <form onSubmit={handleSubmit}>
          <Stack>
            <TextInput
              type="datetime-local"
              label="Arrival Time (Required)"
              value={arrivedAt}
              onChange={(e) => {
                setArrived(e.currentTarget.value);
                setFieldErrors((f) => ({ ...f, arrivedAt: undefined }));
              }}
              error={fieldErrors.arrivedAt}
              required
            />
            <TextInput
              type="datetime-local"
              label="Departure Time (Optional)"
              value={departedAt}
              onChange={(e) => {
                setDeparted(e.currentTarget.value);
                setFieldErrors((f) => ({ ...f, departedAt: undefined }));
              }}
              error={fieldErrors.departedAt}
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
