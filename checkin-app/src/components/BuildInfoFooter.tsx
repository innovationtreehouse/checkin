"use client";

import { Text } from "@mantine/core";

// The deployed commit SHA. NEXT_PUBLIC_* vars are inlined into the bundle at
// build time (Dockerfile ARG -> ENV, passed via --build-arg by the deploy
// workflow), so this is the SHA of the image that's actually running.
// VERCEL_GIT_COMMIT_SHA is kept as a fallback for Vercel-style builds; unset in
// local dev -> "dev".
const FULL_SHA =
  process.env.NEXT_PUBLIC_GIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

/** Short, human-facing build label: the 7-char SHA, or "dev" when unbuilt. */
export function buildLabel(sha: string | undefined | null): string {
  if (!sha) return "dev";
  return sha.slice(0, 7);
}

export function BuildInfoFooter() {
  const label = buildLabel(FULL_SHA);
  return (
    <Text
      component="div"
      size="xs"
      c="dimmed"
      ta="right"
      px="md"
      title={FULL_SHA ? `commit ${FULL_SHA}` : "local development build"}
      style={{ lineHeight: "28px", fontFamily: "var(--mantine-font-family-monospace)" }}
    >
      build {label}
    </Text>
  );
}
