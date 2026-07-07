"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Alert, Anchor, Button, Card, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconPhone } from "@tabler/icons-react";
import { useTodoCounts } from "@/hooks/useTodoCounts";

type Contact = { id: number; name: string; phone: string; email: string | null; relationship: string | null };
type HouseholdContacts = { householdId: number; householdName: string; participants: string[]; contacts: Contact[] };

/**
 * "Contacts" subtab of staff "My Programs": time-scoped emergency-contact access.
 * Lists the caller's led programs (from the nav todo-counts) and, on demand,
 * fetches each program's roster households + emergency contacts. When the program
 * is outside its access window (or has no dates), the API returns a 403 whose
 * message explains the time-scoping — shown inline here.
 * See docs/designs/LEAD_EMERGENCY_CONTACT_ACCESS.md.
 */
export default function MyProgramsContacts() {
  const { status } = useSession();
  const counts = useTodoCounts(status === "authenticated");
  const programs = counts?.lead?.programs ?? [];

  if (programs.length === 0) return null; // layout shows loader / redirects non-leads

  return (
    <Stack>
      <Text c="dimmed" size="sm">
        View emergency contacts for the families in a program you lead. Access is limited to the
        program&apos;s dates (plus a week either side); outside that window, ask a board member.
      </Text>
      {programs.map((p) => (
        <ProgramContacts key={p.id} programId={p.id} name={p.name} />
      ))}
    </Stack>
  );
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; households: HouseholdContacts[] }
  | { kind: "denied"; message: string };

function ProgramContacts({ programId, name }: { programId: number; name: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/my-programs/programs/${programId}/emergency-contacts`);
      const body = await res.json();
      if (res.ok) setState({ kind: "loaded", households: body.households ?? [] });
      else setState({ kind: "denied", message: body.error ?? "Emergency contacts aren't available for this program." });
    } catch {
      setState({ kind: "denied", message: "Couldn't load emergency contacts. Try again." });
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" align="center" mb="sm">
        <Title order={4}>{name}</Title>
        {state.kind !== "loaded" && (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPhone size={16} />}
            loading={state.kind === "loading"}
            onClick={load}
          >
            View emergency contacts
          </Button>
        )}
      </Group>

      {state.kind === "denied" && (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} variant="light">
          {state.message}
        </Alert>
      )}

      {state.kind === "loading" && <Loader size="sm" />}

      {state.kind === "loaded" &&
        (state.households.length === 0 ? (
          <Text c="dimmed" size="sm">No participants enrolled in this program yet.</Text>
        ) : (
          <Stack gap="md">
            {state.households.map((h) => (
              <div key={h.householdId}>
                <Text fw={600} size="sm">{h.householdName}</Text>
                {h.participants.length > 0 && (
                  <Text c="dimmed" size="xs" mb={4}>Participant{h.participants.length > 1 ? "s" : ""}: {h.participants.join(", ")}</Text>
                )}
                {h.contacts.length === 0 ? (
                  <Text c="red" size="xs">No emergency contacts on file.</Text>
                ) : (
                  h.contacts.map((c) => (
                    <Group key={c.id} gap="xs" wrap="nowrap">
                      <Text size="sm">
                        {c.name}
                        {c.relationship ? ` (${c.relationship})` : ""}
                      </Text>
                      <Anchor href={`tel:${c.phone}`} size="sm">{c.phone}</Anchor>
                      {c.email && <Text size="sm" c="dimmed">{c.email}</Text>}
                    </Group>
                  ))
                )}
              </div>
            ))}
          </Stack>
        ))}
    </Card>
  );
}
