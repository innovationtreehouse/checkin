"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Center, Loader } from "@mantine/core";

// Bare /attendance is now just the entry point — the Current view lives at
// /attendance/current. Redirect here, preserving query params so signed kiosk
// URLs (/attendance?mode=kiosk&sig=...&ts=...&nonce=...) keep working.
function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(`/attendance/current${qs ? `?${qs}` : ""}`);
  }, [router, searchParams]);
  return <Center mih="100vh"><Loader /></Center>;
}

export default function AttendanceIndex() {
  return (
    <Suspense fallback={<Center mih="100vh"><Loader /></Center>}>
      <Redirect />
    </Suspense>
  );
}
