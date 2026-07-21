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
// `git describe --tags --long --abbrev=7 --always`, e.g. "v1.0.8-0-ge790e17".
// Strictly more informative than the bare SHA — it carries the ancestor tag and
// the distance from it — so it WINS over the tag/sha pair when present.
const GIT_DESCRIBE = process.env.NEXT_PUBLIC_GIT_DESCRIBE;
// Branch the image was built from. Read defensively: nothing sets this yet on
// main. It is deliberately NOT introduced here — the staging deploy PR adds the
// build arg, and this reads it the moment that lands, with no further change.
// Until then it is undefined and the label is simply the describe string.
const GIT_BRANCH = process.env.NEXT_PUBLIC_GIT_BRANCH;

/**
 * Human-facing build label, most informative form first:
 *   "<branch> <describe>"  — e.g. "rel/1.0 v1.0.8-0-ge790e17"
 *   "<describe>"           — when the branch is unknown
 *   "<tag> <7-char sha>"   — pre-describe fallback, a tagged build
 *   "<7-char sha>"         — pre-describe fallback, untagged
 *   "dev"                  — nothing was stamped at all
 *
 * The fallbacks are not dead code: an image built before this change, or any
 * build whose checkout was shallow (describe needs tags), still renders a
 * sensible label rather than "dev".
 */
export function buildLabel(
  sha: string | undefined | null,
  tag?: string | null,
  describe?: string | null,
  branch?: string | null,
): string {
  const version = describe || (sha ? (tag ? `${tag} ${sha.slice(0, 7)}` : sha.slice(0, 7)) : "");
  if (!version) return "dev";
  return branch ? `${branch} ${version}` : version;
}

export function BuildInfoFooter() {
  const label = buildLabel(FULL_SHA, RELEASE_TAG, GIT_DESCRIBE, GIT_BRANCH);
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
