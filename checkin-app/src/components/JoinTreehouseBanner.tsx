import Link from "next/link";
import { Button, Card, Group, Text } from "@mantine/core";

/**
 * Visitor call-to-action — shown to logged-in non–Treehouse Members. Copy adapts
 * to the household's in-flight application state so a returning applicant sees
 * "Continue" (or a background-check status) instead of a stale "Get started".
 *
 * `processStatus` is the current OrgMembershipProcess status (null = no
 * application started yet). Render only when the viewer is not an active member.
 */
export default function JoinTreehouseBanner({
  processStatus = null,
}: {
  processStatus?: string | null;
}) {
  const { title, sub, cta } = bannerCopy(processStatus);
  return (
    <Card withBorder radius="md" padding="md" bg="var(--mantine-color-blue-light)">
      <Group justify="space-between" wrap="wrap" gap="md">
        <div>
          <Text fw={700} fz="lg">{title}</Text>
          <Text size="sm" c="dimmed">{sub}</Text>
        </div>
        {cta && (
          <Button component={Link} href="/membership" style={{ whiteSpace: "nowrap" }}>
            {cta}
          </Button>
        )}
      </Group>
    </Card>
  );
}

function bannerCopy(status: string | null): { title: string; sub: string; cta: string | null } {
  switch (status) {
    case "INTAKE":
    case "PENDING_EXTERNAL_ACTION":
    case "PENDING_PAYMENT":
      return {
        title: "Finish your Treehouse membership application",
        sub: "Pick up where you left off — we saved your progress.",
        cta: "Continue →",
      };
    case "PENDING_BG_CLEARANCE":
    case "PENDING_BG_REVIEW":
      return {
        title: "Membership application — background check in progress",
        sub: "We're reviewing your background check and will email you when it clears.",
        cta: "View status →",
      };
    default:
      // No application started yet.
      return {
        title: "Join the Treehouse — become a Treehouse Member today!",
        sub: "Tell us about your family to start your membership application.",
        cta: "Get started →",
      };
  }
}
