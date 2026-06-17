import Link from "next/link";
import { Button, Card, Group, Text } from "@mantine/core";

/**
 * Visitor call-to-action — shown to logged-in non-members to start a membership
 * application. Render only when the viewer is not an active member.
 */
export default function JoinTreehouseBanner() {
  return (
    <Card withBorder radius="md" padding="md" bg="var(--mantine-color-blue-light)">
      <Group justify="space-between" wrap="wrap" gap="md">
        <div>
          <Text fw={700} fz="lg">Join the Treehouse — become a member today!</Text>
          <Text size="sm" c="dimmed">
            Tell us about your family to start your membership application.
          </Text>
        </div>
        <Button component={Link} href="/membership" style={{ whiteSpace: "nowrap" }}>
          Get started →
        </Button>
      </Group>
    </Card>
  );
}
