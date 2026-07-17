"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Group, Table, Text, Title } from "@mantine/core";

/**
 * Board-facing Shopify ↔ activation match audit (lib/finance/matchAudit.ts via
 * GET /api/finance-ops/s-read/match-audit). Button-fired, never on page load —
 * the audit sweeps the whole mirror-relevant surface and wakes the scale-to-zero
 * cluster, so a human asks for it when something looks wrong.
 *
 * Rendering rule: clean buckets collapse to a one-line count; only the gap
 * buckets (unclaimed paid orders, activations with no payment basis, order ids
 * missing from the mirror) get row-level tables. Manual/scholarship rows are
 * listed too — they are legitimate, but "who certified what" is exactly what an
 * auditor is here to see.
 */

// Mirror of lib/finance/matchAudit.ts result types (client copy, house pattern).
type AuditOrderRow = {
  bucket: 'MATCHED' | 'TRACKED_EXCEPTION' | 'UNCLAIMED_PAID' | 'UNCLAIMED_UNPAID';
  orderLegacyId: string | null;
  name: string | null;
  customerEmail: string | null;
  financialStatus: string | null;
  totalCents: number;
  expected: string[];
};
type AuditMembershipRow = {
  bucket: 'ORDER_MATCHED' | 'MANUAL_CERTIFIED' | 'ORDER_NOT_IN_MIRROR' | 'NO_PAYMENT_BASIS';
  processId: number;
  householdName: string | null;
  shopifyOrderId: string | null;
  certifiedByName: string | null;
};
type AuditEnrollmentRow = {
  bucket: 'ORDER_MATCHED' | 'SCHOLARSHIP_APPROVED' | 'ORDER_NOT_IN_MIRROR' | 'NO_PAYMENT_BASIS';
  programId: number;
  programName: string;
  personId: number;
  personName: string | null;
  shopifyOrderId: string | null;
};
type MatchAuditResult = {
  variantCoverage: { lines: number; withVariant: number };
  orders: AuditOrderRow[];
  memberships: AuditMembershipRow[];
  enrollments: AuditEnrollmentRow[];
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function MatchAuditPanel() {
  const [result, setResult] = useState<MatchAuditResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/finance-ops/s-read/match-audit');
      if (res.status === 503) {
        setResult(null);
        setError('The Shopify mirror is not wired in this environment.');
        return;
      }
      if (!res.ok) throw new Error();
      setResult((await res.json()) as MatchAuditResult);
    } catch {
      setResult(null);
      setError('Match audit failed to run — see the server log, or run diagnostics on the System Status page.');
    } finally {
      setRunning(false);
    }
  };

  const unclaimedPaid = result?.orders.filter((o) => o.bucket === 'UNCLAIMED_PAID') ?? [];
  const membershipGaps = result?.memberships.filter((m) => m.bucket === 'NO_PAYMENT_BASIS' || m.bucket === 'ORDER_NOT_IN_MIRROR') ?? [];
  const enrollmentGaps = result?.enrollments.filter((e) => e.bucket === 'NO_PAYMENT_BASIS' || e.bucket === 'ORDER_NOT_IN_MIRROR') ?? [];
  const manual = result?.memberships.filter((m) => m.bucket === 'MANUAL_CERTIFIED') ?? [];
  const scholarships = result?.enrollments.filter((e) => e.bucket === 'SCHOLARSHIP_APPROVED') ?? [];
  const gapCount = unclaimedPaid.length + membershipGaps.length + enrollmentGaps.length;

  const count = (label: string, n: number) => (
    <Text size="sm" component="span" mr="md">{label}: <b>{n}</b></Text>
  );

  return (
    <Card withBorder radius="md" padding="lg" mt="md">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Shopify ↔ Activation Match Audit</Title>
        <Button size="xs" variant="light" onClick={run} loading={running}>Run match audit</Button>
      </Group>
      <Text size="sm" c="dimmed">
        Checks that every membership/program purchase (matched by variant) has an activation, and every
        activation has an order, a board certification, or an approved scholarship behind it. Donations and
        merchandise never match a known variant and are not expected to reconcile.
      </Text>

      {error && <Alert color="red" mt="md">{error}</Alert>}

      {result && (
        <>
          {result.variantCoverage.withVariant === 0 && result.variantCoverage.lines > 0 && (
            <Alert color="red" mt="md">
              The mirror has {result.variantCoverage.lines} order lines but none carry a variant id — it predates
              variant mirroring. The order side of this audit is blind until an s-read <b>backfill</b> sync runs.
            </Alert>
          )}

          <Group mt="md" gap="xs">
            {gapCount === 0
              ? <Badge color="green">No gaps</Badge>
              : <Badge color="red">{gapCount} gap(s)</Badge>}
            {count('Orders matched', result.orders.filter((o) => o.bucket === 'MATCHED').length)}
            {count('Tracked as exceptions', result.orders.filter((o) => o.bucket === 'TRACKED_EXCEPTION').length)}
            {count('Memberships matched', result.memberships.filter((m) => m.bucket === 'ORDER_MATCHED').length)}
            {count('Enrollments matched', result.enrollments.filter((e) => e.bucket === 'ORDER_MATCHED').length)}
            {count('Board-certified', manual.length)}
            {count('Scholarships', scholarships.length)}
          </Group>

          {unclaimedPaid.length > 0 && (
            <>
              <Title order={5} mt="md" c="red">Paid orders with no activation</Title>
              <Table striped withTableBorder mt="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Order</Table.Th><Table.Th>Email</Table.Th><Table.Th>Total</Table.Th><Table.Th>Expected</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {unclaimedPaid.map((o, i) => (
                    <Table.Tr key={o.orderLegacyId ?? `row-${i}`}>
                      <Table.Td>{o.name ?? o.orderLegacyId}</Table.Td>
                      <Table.Td>{o.customerEmail}</Table.Td>
                      <Table.Td>{dollars(o.totalCents)}</Table.Td>
                      <Table.Td>{o.expected.join(', ')}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}

          {(membershipGaps.length > 0 || enrollmentGaps.length > 0) && (
            <>
              <Title order={5} mt="md" c="red">Activations without a payment basis</Title>
              <Table striped withTableBorder mt="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>What</Table.Th><Table.Th>Who</Table.Th><Table.Th>Problem</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {membershipGaps.map((m) => (
                    <Table.Tr key={`m-${m.processId}`}>
                      <Table.Td>Membership process {m.processId}</Table.Td>
                      <Table.Td>{m.householdName}</Table.Td>
                      <Table.Td>{m.bucket === 'NO_PAYMENT_BASIS' ? 'No order and no certification' : `Order ${m.shopifyOrderId} not in the mirror`}</Table.Td>
                    </Table.Tr>
                  ))}
                  {enrollmentGaps.map((e) => (
                    <Table.Tr key={`e-${e.programId}-${e.personId}`}>
                      <Table.Td>{e.programName}</Table.Td>
                      <Table.Td>{e.personName}</Table.Td>
                      <Table.Td>{e.bucket === 'NO_PAYMENT_BASIS' ? 'No order and no scholarship approval' : `Order ${e.shopifyOrderId} not in the mirror`}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}

          {(manual.length > 0 || scholarships.length > 0) && (
            <>
              <Title order={5} mt="md">Manual — legitimate, listed for audit</Title>
              <Table striped withTableBorder mt="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>What</Table.Th><Table.Th>Who</Table.Th><Table.Th>Basis</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {manual.map((m) => (
                    <Table.Tr key={`man-${m.processId}`}>
                      <Table.Td>Membership process {m.processId}</Table.Td>
                      <Table.Td>{m.householdName}</Table.Td>
                      <Table.Td>Certified by {m.certifiedByName}</Table.Td>
                    </Table.Tr>
                  ))}
                  {scholarships.map((e) => (
                    <Table.Tr key={`sch-${e.programId}-${e.personId}`}>
                      <Table.Td>{e.programName}</Table.Td>
                      <Table.Td>{e.personName}</Table.Td>
                      <Table.Td>Scholarship / payment plan approved</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </>
      )}
    </Card>
  );
}
