import { Alert, Card, Stepper, Text } from "@mantine/core";
import { INITIAL_PHASES, phaseIndex } from "@/lib/membership/phases";
import type { MembershipProcessStatus } from "@/generated/prisma/client";

/**
 * Left-rail flow diagram for the membership application. Shows the INITIAL
 * phases with the caller's current position; BLOCKED renders an inline alert
 * (the board has been notified) rather than a normal step.
 */
export default function MembershipFlowStepper({
  currentStatus,
}: {
  currentStatus: MembershipProcessStatus | null;
}) {
  const blocked = currentStatus === "BLOCKED";
  // Before starting (null), nothing is complete; treat position as -1.
  const activeIdx = currentStatus ? phaseIndex(currentStatus) : -1;

  return (
    <Card withBorder radius="md" padding="lg" miw={240}>
      <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb="md">
        Your application
      </Text>

      {blocked && (
        <Alert color="red" variant="light" mb="md">
          Your application needs attention. Our team has been notified and will reach out.
        </Alert>
      )}

      <Stepper active={activeIdx} orientation="vertical" size="sm" iconSize={22}>
        {INITIAL_PHASES.map((phase) => (
          <Stepper.Step key={phase.status} label={phase.label} description={phase.description} />
        ))}
      </Stepper>
    </Card>
  );
}
