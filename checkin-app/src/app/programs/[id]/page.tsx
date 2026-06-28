"use client";

import { use, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Anchor, Button, Card, Center, Container, Divider, Group, Loader, Radio, Stack, Text, Title } from '@mantine/core';
import { formatDate, calculateAge } from '@/lib/time';
import { notifyNavRefresh } from '@/lib/nav-refresh';
import { formatCents } from '@inventory/money';

type ProgramDetail = {
  id: number;
  name: string;
  begin: string | null;
  end: string | null;
  leadMentorId: number | null;
  leadMentor?: { name: string | null; email: string } | null;
  participants: { participantId: number, status?: string }[];
  enrollmentStatus: string;
  memberPriceCents: number | null;
  nonMemberPriceCents: number | null;
  shopifyMemberVariantId: string | null;
  shopifyNonMemberVariantId: string | null;
  minAge: number | null;
  maxAge: number | null;
};

type SessionUser = { sysadmin?: boolean; boardMember?: boolean; id: number };

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
  const [householdMembers, setHouseholdMembers] = useState<{ id: number; name: string | null; dob: string | null }[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState<number | null>(null);
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
        if (data.household && data.household.participants) {
          setHouseholdMembers(data.household.participants);
          const me = data.household.participants.find((p: { id: number }) => p.id === currentUserId);
          if (me) setSelectedParticipantId(me.id);
          else setSelectedParticipantId(data.household.participants[0]?.id || currentUserId);
        } else {
          setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
          setSelectedParticipantId(currentUserId);
        }
      } else {
        setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
        setSelectedParticipantId(currentUserId);
      }
    } catch {
      const currentUserId = (session.user as SessionUser).id;
      setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
      setSelectedParticipantId(currentUserId);
    } finally {
      setLoadingHousehold(false);
    }
  };

  const handleRequestPaymentPlan = async () => {
    if (!session || !selectedParticipantId) return router.push('/');

    setEnrolling(true);
    setMessage("");

    try {
      let res = await fetch(`/api/programs/${id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: selectedParticipantId })
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error || "Failed to start enrollment.");
        setEnrolling(false);
        return;
      }

      res = await fetch(`/api/programs/${id}/request-payment-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: selectedParticipantId })
      });

      if (res.ok) {
        setSuccessMessage("Requested! Please check your email for communication from the finance committee of the board.");
        fetchProgram();
        notifyNavRefresh();
      } else {
        setMessage("Enrolled as pending, but failed to alert the finance committee. Please email them directly.");
      }
    } catch {
      setMessage("Network error requesting payment plan.");
    } finally {
      setEnrolling(false);
    }
  };

  const handleEnroll = async (override = false) => {
    if (!session || !selectedParticipantId) {
      router.push('/');
      return;
    }

    const isPayingOnShopify = !override && (program?.memberPriceCents || program?.nonMemberPriceCents);

    setEnrolling(true);
    setMessage("");

    try {
      const res = await fetch(`/api/programs/${id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: selectedParticipantId, override })
      });

      if (res.ok) {
        notifyNavRefresh();
        if (isPayingOnShopify && program) {
          setSuccessMessage("Redirecting to Shopify for secure payment...");

          const householdRes = await fetch('/api/household');
          let isMember = false;
          if (householdRes.ok) {
            const householdData = await householdRes.json();
            isMember = householdData.household?.membership?.status === "ACTIVE" || false;
          }

          const variantId = isMember ? program.shopifyMemberVariantId : program.shopifyNonMemberVariantId;

          if (variantId) {
            const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
            const checkoutUrl = `https://${storeDomain}/cart/${variantId}:1?attributes[CheckMeIn_Account_ID]=${selectedParticipantId}&attributes[Program_ID]=${id}`;
            window.location.href = checkoutUrl;
          } else {
            setSuccessMessage("Enrolled! (Note: No pricing variant configured for this tier)");
            fetchProgram();
          }
        } else {
          setSuccessMessage("Successfully enrolled!");
          setRequiresOverride(false);
          fetchProgram();
        }
      } else {
        const data = await res.json();
        if (data.requiresOverride) {
          setRequiresOverride(true);
          setMessage(data.error);
        } else {
          setMessage(data.error || "Failed to enroll in program.");
        }
      }
    } catch {
      setMessage("Network error during enrollment.");
    } finally {
      if (!isPayingOnShopify) setEnrolling(false);
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
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
  const canManage = !!(session && (user?.sysadmin || user?.boardMember || user?.id === program.leadMentorId));
  const isClosed = program.enrollmentStatus === 'CLOSED';
  const hasPrice = !!(program.memberPriceCents || program.nonMemberPriceCents);
  const alreadySelected = selectedParticipantId !== null && program.participants.some(p => p.participantId === selectedParticipantId);

  return (
    <Container size="md" pb="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" mb="lg">
          <Title order={1}>{program.name}</Title>
          <Group>
            {canManage && (
              <Button color="green" variant="light" onClick={() => router.push(`/admin/programs/${program.id}`)}>
                Manage Program
              </Button>
            )}
            <Button variant="default" onClick={() => router.push('/programs')}>← Back</Button>
          </Group>
        </Group>

        <Card withBorder radius="md" padding="lg" mb="lg">
          <Title order={4} c="dimmed" mb="md">Details</Title>
          <Stack gap="sm">
            {program.leadMentor && (
              <Text><strong>Lead Mentor:</strong> {program.leadMentor.name || 'Unnamed'}</Text>
            )}
            <Text><strong>Starts:</strong> {program.begin ? formatDate(program.begin) : 'TBD'}</Text>
            <Text><strong>Ends:</strong> {program.end ? formatDate(program.end) : 'Ongoing'}</Text>
            <Text>
              <strong>Enrollment:</strong>{' '}
              {program.enrollmentStatus === 'OPEN' ? <Text component="span" c="green">Open</Text> :
                program.enrollmentStatus === 'CLOSED' ? <Text component="span" c="red">Closed</Text> :
                  program.enrollmentStatus === 'WHITELIST' ? <Text component="span" c="yellow">Invite Only</Text> :
                    program.enrollmentStatus}
            </Text>
            {(program.memberPriceCents !== null || program.nonMemberPriceCents !== null) && (
              <>
                <Divider />
                {program.memberPriceCents !== null && <Text><strong>Member Price:</strong> {formatCents(program.memberPriceCents)}</Text>}
                {program.nonMemberPriceCents !== null && <Text><strong>Non-Member Price:</strong> {formatCents(program.nonMemberPriceCents)}</Text>}
                {(!program.memberPriceCents && !program.nonMemberPriceCents) && <Text><strong>Cost:</strong> Free</Text>}
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
                  {isClosed ? "Enrollment Closed" : "Enroll"}
                </Button>
              ) : (
                <>
                  <Button size="md" onClick={() => router.push('/')}>Log In To Enroll</Button>
                  <Button size="md" color="green" onClick={() => router.push(`/programs/${program.id}/register`)} disabled={isClosed}>
                    {isClosed ? "Registration Closed" : "Register (New User)"}
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
                <Radio.Group
                  value={selectedParticipantId !== null ? String(selectedParticipantId) : null}
                  onChange={(v) => setSelectedParticipantId(Number(v))}
                  mb="lg"
                >
                  <Stack>
                    {householdMembers.map((member) => {
                      const alreadyEnrolled = program.participants.some(p => p.participantId === member.id);

                      let ageError: string | null = null;
                      if (program.minAge !== null || program.maxAge !== null) {
                        if (!member.dob) {
                          ageError = "DOB missing";
                        } else {
                          const age = calculateAge(member.dob, program.begin ?? undefined);
                          if (program.minAge !== null && age < program.minAge) ageError = "Too young";
                          if (program.maxAge !== null && age > program.maxAge) ageError = "Too old";
                        }
                      }

                      const disabled = alreadyEnrolled || ageError !== null;

                      return (
                        <Card key={member.id} withBorder radius="md" padding="sm" opacity={disabled ? 0.5 : 1}>
                          <Group justify="space-between">
                            <Radio
                              value={String(member.id)}
                              disabled={disabled}
                              label={member.name || 'Unnamed Participant'}
                            />
                            {alreadyEnrolled && <Text size="sm" c="green">(Already Enrolled)</Text>}
                            {!alreadyEnrolled && ageError && <Text size="sm" c="red">({ageError})</Text>}
                          </Group>
                        </Card>
                      );
                    })}
                  </Stack>
                </Radio.Group>
              )}

              <Stack align="center">
                <Button
                  fullWidth
                  size="md"
                  onClick={() => handleEnroll(false)}
                  disabled={enrolling || !selectedParticipantId || alreadySelected || loadingHousehold}
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

              {requiresOverride && (
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
