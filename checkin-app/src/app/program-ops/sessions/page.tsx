"use client";

import { Suspense } from "react";
import { Center, Loader, Stack, Text, Title } from "@mantine/core";
import { NewEventForm } from "@/app/program-ops/sessions/new/page";

export default function OneTimeEventsIndex() {
  return (
    <Stack>
      <div>
        <Title order={1}>New One Time Event</Title>
        <Text c="dimmed">Schedule a one-off event or manual session.</Text>
      </div>

      <Suspense fallback={<Center mih="60vh"><Loader /></Center>}>
        <NewEventForm />
      </Suspense>
    </Stack>
  );
}
