"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from "next-auth/react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAddressBook,
  IconUrgent,
} from '@tabler/icons-react';
import DevLoginPicker from '@/components/DevLoginPicker';
import { useIsDevInstance, useIsLocalInstance } from '@/components/EnvProvider';
import JoinTreehouseBanner from '@/components/JoinTreehouseBanner';
import Notifications from '@/components/Notifications';
import { RoleBadge } from '@/components/ui/RoleBadge';
import type { SessionUser, BoardMember } from '@/types/participant';

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  const isDevInstance = useIsDevInstance();
  const isLocalInstance = useIsLocalInstance();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isCheckedIn, setIsCheckedIn] = useState<boolean | null>(null);

  const [isLastKeyholder, setIsLastKeyholder] = useState(false);
  const [isTwoDeepViolation, setIsTwoDeepViolation] = useState(false);
  const [isMember, setIsMember] = useState<boolean | null>(null);

  const [showBoardDirectory, setShowBoardDirectory] = useState(false);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const checkAttendanceStatus = useCallback(async () => {
    if (!session?.user) return;
    try {
      const res = await fetch('/api/attendance');
      const data = await res.json();
      const currentUserId = (session.user as SessionUser)?.id;

      // Works with both "full" and "limited" access responses
      if (data.access === "full") {
        const attendanceList = data.attendance || [];
        const userActiveVisit = attendanceList.find(
          (visit: { participant: { id: number } }) => visit.participant.id === currentUserId
        );
        setIsCheckedIn(!!userActiveVisit);
      } else {
        // Limited access — use self field
        setIsCheckedIn(data.self !== null && data.self !== undefined);
      }

      // Use server-computed safety flags
      if (data.safety) {
        const userIsKeyholder = (session.user as SessionUser)?.isKeyholder;
        setIsLastKeyholder(data.safety.isLastKeyholder && userIsKeyholder);
        setIsTwoDeepViolation(data.safety.isTwoDeepViolation);
      } else {
        setIsLastKeyholder(false);
        setIsTwoDeepViolation(false);
      }
    } catch (err) {
      console.error("Failed to fetch attendance status", err);
    }
  }, [session]);

  useEffect(() => {
    checkAttendanceStatus();
  }, [checkAttendanceStatus]);

  useEffect(() => {
    if (!session?.user) {
      setIsMember(null);
      return;
    }
    let cancelled = false;
    fetch('/api/membership')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setIsMember(data.membershipStatus === 'ACTIVE');
      })
      .catch(() => { /* non-blocking: leave banner hidden on error */ });
    return () => { cancelled = true; };
  }, [session]);

  const handleToggleCheckin = async () => {
    if (!session?.user) return;
    setLoading(true);
    setMessage("");
    try {
      const participantId = (session.user as SessionUser)?.id;
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`${data.type === 'checkin' ? 'Successfully checked in!' : 'Successfully checked out!'}`);
        await checkAttendanceStatus(); // Re-fetch the status securely
      } else {
        setMessage(`Error: ${data.error || 'Failed to update attendance'}`);
      }
    } catch {
      setMessage("Failed to connect to API");
    }
    setLoading(false);
  };

  const fetchBoardDirectory = async () => {
    setShowBoardDirectory(true);
    setLoadingBoard(true);
    try {
      const res = await fetch('/api/directory/board');
      if (res.ok) {
        const data = await res.json();
        setBoardMembers(data.boardMembers);
      } else {
        setMessage("Failed to load board directory.");
      }
    } catch {
      setMessage("Network error loading directory.");
    } finally {
      setLoadingBoard(false);
    }
  };

  const user = session?.user as SessionUser | undefined;
  const canSelfCheckin =
    !!user?.isSysadmin || !!user?.isBoardMember || !!user?.isKeyholder || isDevInstance;
  const isPrivileged = !!user?.isSysadmin || !!user?.isKeyholder;

  return (
    <Container size="sm" py="xl">
      <Card withBorder shadow="sm" radius="md" padding="xl">
        <Stack align="center" gap="xs" mb="lg">
          <Title order={1}>{isDevInstance ? 'CMI-dev' : 'CheckMeIn'}</Title>
          <Text c="dimmed" size="lg">
            The next-generation facility check-in system.
          </Text>
        </Stack>

        <Stack>
          {session ? (
            <>
              <Paper withBorder radius="md" p="md">
                <Text ta="center">
                  Welcome back, <strong>{session.user?.name || session.user?.email}</strong>!
                </Text>
                {(user?.isSysadmin || user?.isKeyholder) && (
                  <Group justify="center" gap="xs" mt="xs">
                    {user?.isSysadmin && <RoleBadge role="isSysadmin" />}
                    {user?.isKeyholder && <RoleBadge role="isKeyholder" />}
                  </Group>
                )}
              </Paper>

              {/* Visitor call-to-action — only for non-members */}
              {isMember === false && <JoinTreehouseBanner />}

              {/* In-app red-dot indicators (membership reviewer queue / blocked apps, …) */}
              <Notifications />

              {/* Operational Warnings */}
              {isTwoDeepViolation && (
                <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Critical Warning">
                  Two-Deep Compliance is failing. An unaccompanied student is present without
                  sufficient adult supervision.
                </Alert>
              )}
              {isLastKeyholder && (
                <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="You are the last Keyholder present.">
                  If you check out now, the facility will be marked as Closed and all remaining
                  occupants will be forcibly checked out.
                </Alert>
              )}

              {/* Check-in Toggle Button — in production, only privileged users can self-check-in from the web */}
              {isCheckedIn !== null &&
                (canSelfCheckin ? (
                  <Button
                    size="lg"
                    fullWidth
                    color={isCheckedIn ? 'red' : 'green'}
                    onClick={handleToggleCheckin}
                    loading={loading}
                  >
                    {isCheckedIn ? 'Check Out' : 'Check In'}
                  </Button>
                ) : (
                  <Alert color="gray" variant="light" ta="center">
                    📛 Please use the kiosk badge scanner to check in and out.
                  </Alert>
                ))}

              {/* Board Directory Button for Keyholders/Admins */}
              {isPrivileged && (
                <>
                  <Button
                    variant="default"
                    fullWidth
                    leftSection={<IconAddressBook size={18} />}
                    onClick={fetchBoardDirectory}
                  >
                    View Board Directory
                  </Button>
                  <Button
                    variant="light"
                    color="red"
                    fullWidth
                    leftSection={<IconUrgent size={18} />}
                    onClick={() => router.push('/safety')}
                  >
                    Emergency Contacts
                  </Button>
                </>
              )}
            </>
          ) : (
            <Stack align="center">
              <Text c="dimmed" ta="center">
                Explore our upcoming events and sign up, or sign in to access your dashboard.
              </Text>

              <Button
                color="green"
                size="md"
                onClick={() => router.push('/programs')}
                style={{ maxWidth: 300, width: '100%' }}
              >
                See Public Programs
              </Button>

              <Divider label="OR" labelPosition="center" w="100%" maw={300} />

              <Button
                size="md"
                onClick={() => signIn('google')}
                style={{ maxWidth: 300, width: '100%' }}
              >
                Sign In To Dashboard
              </Button>
              {isLocalInstance && <DevLoginPicker />}
            </Stack>
          )}
        </Stack>

        {message && (
          <Alert mt="lg" variant="light">
            {message}
          </Alert>
        )}
      </Card>

      <Modal
        opened={showBoardDirectory}
        onClose={() => setShowBoardDirectory(false)}
        title={<Title order={4}>Board Directory</Title>}
        centered
      >
        {loadingBoard ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text c="dimmed">Loading contacts...</Text>
          </Group>
        ) : boardMembers.length === 0 ? (
          <Text c="dimmed">No board members found.</Text>
        ) : (
          <Stack>
            {boardMembers.map((member) => (
              <Paper key={member.id} withBorder radius="md" p="md">
                <Text fw={600}>{member.name || 'Unnamed'}</Text>
                <Text size="sm">
                  ✉️ <Anchor href={`mailto:${member.email}`}>{member.email}</Anchor>
                </Text>
                {member.phone && (
                  <Text size="sm">
                    📞 <Anchor href={`tel:${member.phone.replace(/\D/g, '')}`}>{member.phone}</Anchor>
                  </Text>
                )}
              </Paper>
            ))}
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
