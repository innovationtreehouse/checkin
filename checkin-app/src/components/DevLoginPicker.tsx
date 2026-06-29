"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Badge, Card, Center, Divider, Group, SimpleGrid, Stack, Text } from "@mantine/core";

interface Persona {
  id: number;
  email: string;
  name: string | null;
  sysadmin: boolean;
  boardMember: boolean;
  keyholder: boolean;
  backgroundCheckReviewer: boolean;
  dateOfBirth: string | null;
  householdId: number | null;
  toolStatuses: { toolId: number; level: string }[];
}

/**
 * DevLoginPicker — renders a list of debug personas for quick login.
 * Only rendered in dev mode when the user is NOT signed in.
 */
export default function DevLoginPicker() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/dev-personas", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setPersonas(data.personas || []);
        setNow(Date.now());
        setLoading(false);
      })
      .catch(() => {
        setNow(Date.now());
        setLoading(false);
      });
  }, []);

  const handleLogin = (persona: Persona) => {
    setSigningIn(persona.email);
    // Initial local login: no current session, so the mint is a plain login as this persona
    // (impersonatedBy stays null). The same flow handles impersonation once signed in.
    signIn("persona-mint", { personaId: String(persona.id), mode: "impersonate", callbackUrl: "/" });
  };

  const getRoleBadges = (p: Persona): { label: string; color: string }[] => {
    const badges: { label: string; color: string }[] = [];
    if (p.sysadmin) badges.push({ label: "Sysadmin", color: "red" });
    if (p.boardMember) badges.push({ label: "Board", color: "grape" });
    if (p.keyholder) badges.push({ label: "Keyholder", color: "blue" });
    if (p.backgroundCheckReviewer) badges.push({ label: "BG Reviewer", color: "teal" });
    if (p.toolStatuses?.length > 0) badges.push({ label: "Certified", color: "green" });
    if (p.householdId) badges.push({ label: "Household", color: "indigo" });
    if (p.dateOfBirth && now !== null) {
      const age = Math.floor((now - new Date(p.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) badges.push({ label: `Student (${age})`, color: "pink" });
    }
    return badges;
  };

  if (process.env.NODE_ENV === 'production') return null;

  if (loading) {
    return (
      <Center mt="md">
        <Text c="dimmed">Loading dev personas...</Text>
      </Center>
    );
  }

  if (personas.length === 0) return null;

  return (
    <Stack mt="md" w="100%">
      <Divider label="🛠 Dev Quick Login" labelPosition="center" />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {personas.map((p) => (
          <Card
            key={p.id}
            id={`dev-login-${p.email.split("@")[0].replace(/\./g, "-")}`}
            withBorder
            radius="md"
            padding="sm"
            onClick={() => { if (!signingIn) handleLogin(p); }}
            style={{
              cursor: signingIn ? "wait" : "pointer",
              opacity: signingIn && signingIn !== p.email ? 0.5 : 1,
            }}
          >
            <Text fw={600} size="sm">
              {signingIn === p.email ? "⏳ " : ""}{p.name || p.email}
            </Text>
            <Text size="xs" c="dimmed">{p.email}</Text>
            {getRoleBadges(p).length > 0 && (
              <Group gap={4} mt={4}>
                {getRoleBadges(p).map((b) => (
                  <Badge key={b.label} color={b.color} size="xs" variant="filled">
                    {b.label}
                  </Badge>
                ))}
              </Group>
            )}
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
