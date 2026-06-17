"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Alert, Button, Group, Text } from "@mantine/core";

/**
 * Non-blocking login-time nudge for household leads whose membership is up for
 * renewal. Distinct from OnboardingGate (a hard modal) — renewal is a reminder,
 * not a gate. Dismissable for the session.
 */
export default function RenewalBanner() {
  const { status } = useSession();
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/membership/renewal-status");
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.renewalDue && sessionStorage.getItem("renewal_banner_dismissed") !== "true") {
          setDueDate(data.dueDate ?? null);
          setShow(true);
        }
      } catch {
        /* banner is best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [status]);

  if (!show) return null;

  const dismiss = () => {
    sessionStorage.setItem("renewal_banner_dismissed", "true");
    setShow(false);
  };

  return (
    <Alert color="yellow" variant="light" radius={0} withCloseButton onClose={dismiss} title="Membership renewal due">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Text size="sm">
          Your household membership is up for renewal{dueDate ? ` by ${dueDate}` : ""}. You&apos;re
          still active — confirm to continue for another year.
        </Text>
        <Button component={Link} href="/membership" size="xs" color="yellow" variant="filled">
          Renew now
        </Button>
      </Group>
    </Alert>
  );
}
