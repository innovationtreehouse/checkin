"use client";

import { Text } from "@mantine/core";

// The deployed commit SHA. NEXT_PUBLIC_* vars are inlined into the bundle at
// build time (Dockerfile ARG -> ENV, passed via --build-arg by the deploy
// workflow), so this is the SHA of the image that's actually running.
// VERCEL_GIT_COMMIT_SHA is kept as a fallback for Vercel-style builds; unset in
// local dev -> "dev".
const FULL_SHA =
  process.env.NEXT_PUBLIC_GIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
// Release tag (e.g. "v1.0.0"), set only by the prod deploy workflow. Empty on
// dev/local builds -> the footer shows the hash alone.
const RELEASE_TAG = process.env.NEXT_PUBLIC_RELEASE_TAG;
// Branch (e.g. "main", "rel/1.2"), set by deploy-dev.yml and deploy-staging.yml.
// NOT set by deploy-prod.yml (its ref IS the tag — see the Dockerfile comment).
const GIT_BRANCH = process.env.NEXT_PUBLIC_GIT_BRANCH;

/**
 * Human-facing build label: "<branch> <tag> <7-char sha>", omitting whichever
 * of branch/tag are unset, or "dev" when there is no sha at all.
 */
export function buildLabel(
  sha: string | undefined | null,
  tag?: string | null,
  branch?: string | null,
): string {
  if (!sha) return "dev";
  const short = sha.slice(0, 7);
  return [branch, tag, short].filter(Boolean).join(" ");
}

export function BuildInfoFooter() {
  const label = buildLabel(FULL_SHA, RELEASE_TAG, GIT_BRANCH);
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
