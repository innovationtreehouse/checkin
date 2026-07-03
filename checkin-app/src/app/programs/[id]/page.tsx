"use client";

import { use, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Anchor, Button, Card, Center, Checkbox, Container, Divider, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { formatDate, calculateAge } from '@/lib/time';
import { notifyNavRefresh } from '@/lib/nav-refresh';
import { formatCents } from '@inventory/money';
import { aggregateEnrollOutcomes, buildShopifyCheckoutUrl, type EnrollOutcome } from './enroll';

import { PageLoader } from "@/components/ui/PageLoader";
type ProgramDetail = {
  id: number;
  name: string;
  startAt: string | null;
  endAt: string | null;
  leadMentorId: number | null;
  leadMentor?: { name: string | null; email: string } | null;
  // Absent for non-enrolled callers (route gates the roster); only their own
  // household's rows arrive when enrolled, which is all the "already enrolled"
  // check below needs.
  participants?: { personId: number, status?: string }[];
  _count?: { participants?: number };
  phase: string;
  maxParticipants: number | null;
  enrollmentStatus: string;
  orgMemberPriceCents: number | null;
  nonOrgMemberPriceCents: number | null;
  shopifyOrgMemberVariantId: string | null;
  shopifyNonOrgMemberVariantId: string | null;
  minAge: number | null;
  maxAge: number | null;
};

type SessionUser = { isSysadmin?: boolean; isBoardMember?: boolean; id: number };

export default function ProgramEnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [requiresOverride, setRequiresOverride] = useState(false);

  const [showEnrollmentSelection, setShowEnrollmentSelection] = useState(false);
  const [householdMembers, setHouseholdMembers] = useState<{ id: number; name: string | null; dateOfBirth: string | null; isDeclaredAdult?: boolean }[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<number[]>([]);
  const [loadingHousehold, setLoadingHousehold] = useState(false);

  const fetchProgram = useCallback(async () => {
    try {
      const res = await fetch(`/api/programs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProgram(data);
      } else if (res.status === 404) {
        setMessage("Program not found.");
      } else {
        setMessage("Failed to load program details.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProgram();
  }, [fetchProgram]);

  // Why a member can't be enrolled. Shared by the default selection and the row
  // render so an ineligible member is never auto-selected and then POSTed (which
  // returned a confusing "Date of Birth is missing" for over-25 adults).
  const enrollBlock = (member: { id: number; dateOfBirth: string | null; isDeclaredAdult?: boolean }): { reason: 'enrolled' | 'age' | 'dob' | null; label: string } => {
    if ((program?.participants ?? []).some(p => p.personId === member.id)) return { reason: 'enrolled', label: 'Already Enrolled' };
    if (program && (program.minAge !== null || program.maxAge !== null)) {
      if (!member.dateOfBirth) {
        // A declared over-25 adult is simply outside a child age range — not a
        // missing-data problem the household needs to fix.
        return member.isDeclaredAdult ? { reason: 'age', label: 'Adult' } : { reason: 'dob', label: 'DOB missing' };
      }
      const age = calculateAge(member.dateOfBirth, program.startAt ?? undefined);
      if (program.minAge !== null && age < program.minAge) return { reason: 'age', label: 'Too young' };
      if (program.maxAge !== null && age > program.maxAge) return { reason: 'age', label: 'Too old' };
    }
    return { reason: null, label: '' };
  };

  const startEnrollmentProcess = async () => {
    if (!session) {
      router.push('/');
      return;
    }
    setShowEnrollmentSelection(true);
    setLoadingHousehold(true);

    try {
      const currentUserId = (session.user as SessionUser).id;
      const res = await fetch(`/api/household`);
      if (res.ok) {
        const data = await res.json();
        if (data.household && data.household.householdMembers) {
          const members = data.household.householdMembers;
          setHouseholdMembers(members);
          // Default to me if I'm eligible, else the first eligible member, else
          // none — never auto-select someone who'd fail the age/DOB check.
          const me = members.find((p: { id: number }) => p.id === currentUserId);
          const def = me && enrollBlock(me).reason === null
            ? me.id
            : members.find((m: { id: number; dateOfBirth: string | null; isDeclaredAdult?: boolean }) => enrollBlock(m).reason === null)?.id;
          setSelectedParticipantIds(def != null ? [def] : []);
        } else {
          setHouseholdMembers([{ id: currentUserId, name: "Myself", dateOfBirth: null }]);
          setSelectedParticipantIds([currentUserId]);
        }
      } else {
        setHouseholdMembers([{ id: currentUserId, name: "Myself", dateOfBirth: null }]);
        setSelectedParticipantIds([currentUserId]);
      }
    } catch {
      const currentUserId = (session.user as SessionUser).id;
      setHouseholdMembers([{ id: currentUserId, name: "Myself", dateOfBirth: null }]);
      setSelectedParticipantIds([currentUserId]);
    } finally {
      setLoadingHousehold(false);
    }
  };

  const handleRequestPaymentPlan = async () => {
    if (!session || selectedParticipantIds.length === 0) return router.push('/');

    setEnrolling(true);
    setMessage("");

    const errors: string[] = [];
    let anyRequested = false;

    try {
      for (const participantId of selectedParticipantIds) {
        let res = await fetch(`/api/programs/${id}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId })
        });

        if (!res.ok) {
          const data = await res.json();
          errors.push(data.error || "Failed to start enrollment.");
          continue;
        }

        res = await fetch(`/api/programs/${id}/request-payment-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId })
        });

        if (res.ok) {
          anyRequested = true;
        } else {
          errors.push("Enrolled as pending, but failed to alert the finance committee for one member. Please email them directly.");
        }
      }

      if (anyRequested) {
        notifications.show({ color: "green", message: "Requested! Please check your email for communication from the finance committee of the board." });
        fetchProgram();
        notifyNavRefresh();
      }
      if (errors.length > 0) setMessage(errors.join(" "));
    } catch {
      setMessage("Network error requesting payment plan.");
    } finally {
      setEnrolling(false);
    }
  };

  const handleEnroll = async (override = false) => {
    if (!session || selectedParticipantIds.length === 0) {
      router.push('/');
      return;
    }

    const isPayingOnShopify = !override && (program?.orgMemberPriceCents || program?.nonOrgMemberPriceCents);

    setEnrolling(true);
    setMessage("");

    try {
      const outcomes: EnrollOutcome[] = [];
      for (const participantId of selectedParticipantIds) {
        const res = await fetch(`/api/programs/${id}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId, override })
        });

        // Only the error path carries a JSON body we need (error/requiresOverride);
        // ok and 409 (already enrolled) are both treated as enrolled downstream.
        const data = (res.ok || res.status === 409) ? {} : await res.json();
        outcomes.push({ participantId, ok: res.ok, status: res.status, error: data.error, requiresOverride: data.requiresOverride });
      }

      const { enrolledIds, errors, needsOverride } = aggregateEnrollOutcomes(outcomes);

      if (enrolledIds.length > 0) {
        notifyNavRefresh();
        if (isPayingOnShopify && program) {
          setSuccessMessage("Redirecting to Shopify for secure payment...");

          const householdRes = await fetch('/api/household');
          let isMember = false;
          if (householdRes.ok) {
            const householdData = await householdRes.json();
            isMember = householdData.household?.orgMembership?.status === "ACTIVE" || false;
          }

          const variantId = isMember ? program.shopifyOrgMemberVariantId : program.shopifyNonOrgMemberVariantId;

          if (variantId) {
            const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
            // qty=N single variant + comma-joined account ids — see buildShopifyCheckoutUrl.
            window.location.href = buildShopifyCheckoutUrl(storeDomain, variantId, enrolledIds, id);
            return;
          } else {
            notifications.show({ color: "green", message: "Enrolled! (Note: No pricing variant configured for this tier)" });
            setSuccessMessage("");
            fetchProgram();
          }
        } else {
          notifications.show({ color: "green", message: enrolledIds.length > 1 ? `Successfully enrolled ${enrolledIds.length} members!` : "Successfully enrolled!" });
          setRequiresOverride(false);
          fetchProgram();
        }
      }

      if (needsOverride) setRequiresOverride(true);
      if (errors.length > 0) setMessage(errors.join(" "));
    } catch {
      setMessage("Network error during enrollment.");
    } finally {
      if (!isPayingOnShopify) setEnrolling(false);
    }
  };

  if (loading || status === "loading") {
    return <PageLoader />;
  }

  if (!program) return (
    <Container size="sm" py="xl">
      <Card withBorder radius="md" padding="xl" ta="center">
        <Title order={3}>{message || "Not Found"}</Title>
        <Group justify="center" mt="lg">
          <Button onClick={() => router.push('/programs')}>Back to Directory</Button>
        </Group>
      </Card>
    </Container>
  );

  const user = session?.user as SessionUser | undefined;
  const canManage = !!(session && (user?.isSysadmin || user?.isBoardMember || user?.id === program.leadMentorId));
  const isClosed = program.enrollmentStatus === 'CLOSED';
  const hasPrice = !!(program.orgMemberPriceCents || program.nonOrgMemberPriceCents);

  const enrollableMembers = householdMembers.filter(m => enrollBlock(m).reason === null);
  const ageRange = program.minAge !== null && program.maxAge !== null ? `ages ${program.minAge}–${program.maxAge}`
    : program.minAge !== null ? `ages ${program.minAge} and up`
    : program.maxAge !== null ? `ages ${program.maxAge} and under` : null;

  // Why is enrollment closed? Full wins over phase.
  const enrolledCount = program._count?.participants ?? program.participants?.length ?? 0;
  const isFull = program.maxParticipants != null && enrolledCount >= program.maxParticipants;
  const closedReason = !isClosed ? null
    : isFull ? 'Full'
    : program.phase === 'RUNNING' ? 'Running'
    : program.phase === 'UPCOMING' ? 'Upcoming'
    : program.phase === 'FINISHED' ? 'Ended'
    : null;
  const closedSuffix = closedReason && <Text component="span" c="white"> ({closedReason})</Text>;

  return (
    <Container size="md" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="lg">
          <Title order={1}>{program.name}</Title>
          <Group>
            {canManage && (
              <Button color="green" variant="light" onClick={() => router.push(`/program-ops/programs/${program.id}`)}>
                Manage Program
              </Button>
            )}
            <Button variant="default" onClick={() => router.back()}>← Back</Button>
          </Group>
        </Group>

        <Card withBorder radius="md" padding="lg" mb="lg">
          <Title order={4} c="dimmed" mb="md">Details</Title>
          <Stack gap="sm">
            {program.leadMentor && (
              <Text><strong>Lead Mentor:</strong> {program.leadMentor.name || 'Unnamed'}</Text>
            )}
            <Text><strong>Starts:</strong> {program.startAt ? formatDate(program.startAt) : 'TBD'}</Text>
            <Text><strong>Ends:</strong> {program.endAt ? formatDate(program.endAt) : 'Ongoing'}</Text>
            <Text>
              <strong>Enrollment:</strong>{' '}
              {program.enrollmentStatus === 'OPEN' ? <Text component="span" c="green">Open</Text> :
                program.enrollmentStatus === 'CLOSED' ? <Text component="span" c="red">Closed</Text> :
                  program.enrollmentStatus === 'WHITELIST' ? <Text component="span" c="yellow">Invite Only</Text> :
                    program.enrollmentStatus}
            </Text>
            {(program.orgMemberPriceCents !== null || program.nonOrgMemberPriceCents !== null) && (
              <>
                <Divider />
                {program.orgMemberPriceCents !== null && <Text><strong>Treehouse Member Price:</strong> {formatCents(program.orgMemberPriceCents)}</Text>}
                {program.nonOrgMemberPriceCents !== null && <Text><strong>Non-Member Price:</strong> {formatCents(program.nonOrgMemberPriceCents)}</Text>}
                {(!program.orgMemberPriceCents && !program.nonOrgMemberPriceCents) && <Text><strong>Cost:</strong> Free</Text>}
              </>
            )}
          </Stack>
        </Card>

        {message && <Alert color="red" mb="lg">{message}</Alert>}
        {successMessage && <Alert color="green" mb="lg">{successMessage}</Alert>}

        <Center mt="xl">
          {!showEnrollmentSelection ? (
            <Group justify="center" wrap="wrap">
              {session ? (
                <Button size="md" onClick={startEnrollmentProcess} disabled={isClosed}>
                  {isClosed ? <>Enrollment Closed{closedSuffix}</> : "Enroll"}
                </Button>
              ) : (
                <>
                  <Button size="md" onClick={() => router.push('/')}>Log In To Enroll</Button>
                  <Button size="md" color="green" onClick={() => router.push(`/programs/${program.id}/register`)} disabled={isClosed}>
                    {isClosed ? <>Registration Closed{closedSuffix}</> : "Register (New User)"}
                  </Button>
                </>
              )}
            </Group>
          ) : (
            <Card withBorder radius="md" padding="lg" w="100%" maw={500}>
              <Title order={4} mb="lg">Which of your household wants to enroll?</Title>

              {loadingHousehold ? (
                <Center py="md"><Loader size="sm" /></Center>
              ) : (
                <Checkbox.Group
                  value={selectedParticipantIds.map(String)}
                  onChange={(vals) => setSelectedParticipantIds(vals.map(Number))}
                  mb="lg"
                >
                  <Stack>
                    {householdMembers.map((member) => {
                      const { reason, label } = enrollBlock(member);
                      const disabled = reason !== null;

                      return (
                        <Card key={member.id} withBorder radius="md" padding="sm" opacity={disabled ? 0.5 : 1}>
                          <Group justify="space-between">
                            <Checkbox
                              value={String(member.id)}
                              disabled={disabled}
                              label={member.name || 'Unnamed Participant'}
                            />
                            {reason === 'enrolled' && <Text size="sm" c="green">({label})</Text>}
                            {disabled && reason !== 'enrolled' && <Text size="sm" c="red">({label})</Text>}
                          </Group>
                        </Card>
                      );
                    })}
                  </Stack>
                </Checkbox.Group>
              )}

              {!loadingHousehold && householdMembers.length > 0 && enrollableMembers.length === 0 ? (
                <Alert color="blue" variant="light">
                  No eligible participants in your household for this program{ageRange ? ` (${ageRange})` : ''}.
                </Alert>
              ) : (
              <Stack align="center">
                <Button
                  fullWidth
                  size="md"
                  onClick={() => handleEnroll(false)}
                  disabled={enrolling || selectedParticipantIds.length === 0 || loadingHousehold}
                  loading={enrolling}
                >
                  {hasPrice ? "Pay on Shopify" : "Complete Enrollment"}
                </Button>

                {hasPrice && !isClosed && (
                  <Anchor component="button" type="button" size="sm" onClick={handleRequestPaymentPlan}>
                    request a payment plan from the finance committee of the board
                  </Anchor>
                )}
              </Stack>
              )}

              {requiresOverride && canManage && (
                <Alert color="yellow" variant="light" mt="lg" title="Warning: Enrollment rules not met.">
                  <Text size="sm" mb="md">
                    As an Admin or Lead Mentor, you can bypass this restriction. Are you sure you want
                    to force enroll?
                  </Text>
                  <Button color="yellow" fullWidth onClick={() => handleEnroll(true)}>
                    Force Enroll (Override)
                  </Button>
                </Alert>
              )}
            </Card>
          )}
        </Center>
      </Card>
    </Container>
  );
}
