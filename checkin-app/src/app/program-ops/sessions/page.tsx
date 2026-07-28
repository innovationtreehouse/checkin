"use client";

import { Suspense } from "react";
import { Stack, Text } from "@mantine/core";
import { NewEventForm } from "@/app/program-ops/sessions/new/page";

import { PageLoader } from "@/components/ui/PageLoader";
export default function OneTimeEventsIndex() {
  return (
    <Stack>
      <div>
        <Text c="dimmed">Schedule a one-off event or manual session.</Text>
      </div>

      <Suspense fallback={<PageLoader />}>
        <NewEventForm />
      </Suspense>
    </Stack>
  );
}
