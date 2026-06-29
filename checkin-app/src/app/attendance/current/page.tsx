"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Alert, Anchor, Badge, Box, Button, Card, Center, Group, Loader, Modal, Paper,
  SimpleGrid, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { formatTime } from "@/lib/time";
import { getKioskDisplayNames } from "@/lib/kiosk-names";
import { AttendanceTabs } from "../AttendanceTabs";

type Participant = {
  id: number;
  email: string;
  name?: string | null;
  keyholder: boolean;
  sysadmin: boolean;
  dob?: string | null;
  householdId?: number | null;
  phone?: string | null;
  household?: { emergencyContacts: { id: number; name: string; phone: string; relationship: string | null }[] } | null;
};

type Visit = {
  id: number;
  arrived: string;
  participant: Participant;
  event?: { program?: { id: number; name: string } };
};

type Counts = { keyholders: number; volunteers: number; students: number; total: number };
type SafetyFlags = { isLastKeyholder: boolean; isTwoDeepViolation: boolean };
type FullResponse = { access: "full"; attendance: Visit[]; counts: Counts; safety: SafetyFlags };
type LimitedResponse = { access: "limited"; counts: Counts; safety: SafetyFlags; self: Visit | null; household: Visit[] };
type AttendanceResponse = FullResponse | LimitedResponse;

const isStudent = (dob: string | undefined | null) => {
  if (!dob) return false;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age < 18;
};

type SessionUser = { id: number; sysadmin?: boolean; keyholder?: boolean; boardMember?: boolean; householdId?: number | null };

function KioskDisplayInner() {
  const searchParams = useSearchParams();
  const [isKioskMode, setIsKioskMode] = useState(searchParams.get("mode") === "kiosk");
  const { data: session } = useSession();
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<number | null>(null);
  const [household, setHousehold] = useState<{ leads: { participantId: number }[], participants: Participant[] } | null>(null);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [searchSignOutQuery, setSearchSignOutQuery] = useState("");
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Participant[]>([]);
  const [checkingInId, setCheckingInId] = useState<number | null>(null);

  const currentUserIsSysadmin = (session?.user as SessionUser)?.sysadmin || false;
  const currentUserIsKeyholder = (session?.user as SessionUser)?.keyholder || false;
  const currentUserIsBoardMember = (session?.user as SessionUser)?.boardMember || false;
  const currentUserHouseholdId = (session?.user as SessionUser)?.householdId || null;
  const canManuallyCheckInGlobal = currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember;
  const canAdminCheckout = currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember;
  const canCheckInHousehold = Boolean(currentUserHouseholdId);

  const isFull = data?.access === "full";
  const counts = data?.counts || { keyholders: 0, volunteers: 0, students: 0, total: 0 };
  const safety = data?.safety || { isLastKeyholder: false, isTwoDeepViolation: false };

  const fullAttendance = isFull ? (data as FullResponse).attendance : [];
  const keyholderList = fullAttendance.filter(v => v.participant.keyholder);
  const volunteerList = fullAttendance.filter(v => !v.participant.keyholder && !isStudent(v.participant.dob));
  const studentList = fullAttendance.filter(v => isStudent(v.participant.dob));

  const limitedHousehold = !isFull && data ? (data as LimitedResponse).household : [];
  const limitedSelf = !isFull && data ? (data as LimitedResponse).self : null;
  const householdKeyholders = limitedHousehold.filter(v => v.participant.keyholder);
  const householdVolunteers = limitedHousehold.filter(v => !v.participant.keyholder && !isStudent(v.participant.dob));
  const householdStudents = limitedHousehold.filter(v => isStudent(v.participant.dob));

  const isCheckedIn = isFull
    ? fullAttendance.some(v => v.participant.id === (session?.user as SessionUser)?.id)
    : limitedSelf !== null;

  useEffect(() => {
    const fetchHousehold = async () => {
      if (!currentUserHouseholdId) return;
      try {
        const res = await fetch("/api/household");
        if (res.ok) {
          const hData = await res.json();
          setHousehold(hData.household);
        }
      } catch (error) {
        console.error("Failed to fetch household:", error);
      }
    };
    if (canCheckInHousehold) fetchHousehold();
  }, [canCheckInHousehold, currentUserHouseholdId]);

  useEffect(() => {
    const fetchAttendance = async () => {
      try {
        const headers: Record<string, string> = {};
        const sigParamsUrl = searchParams.get("sig");
        const tsParamsUrl = searchParams.get("ts");
        const nonceParamsUrl = searchParams.get("nonce");
        if (sigParamsUrl && tsParamsUrl && nonceParamsUrl) {
          headers["x-kiosk-signature"] = sigParamsUrl;
          headers["x-kiosk-timestamp"] = tsParamsUrl;
          headers["x-kiosk-nonce"] = nonceParamsUrl;
        }

        const res = await fetch("/api/attendance", { headers });
        const json = await res.json();
        if (res.ok && (json.access === "full" || json.access === "limited")) {
          setData(json);
          setError(null);
          if (json.signedRequest === true) setIsKioskMode(true);
        } else if (!res.ok) {
          setError(json.error || "Failed to load attendance");
        }
      } catch (error) {
        console.error("Failed to fetch attendance:", error);
        setError("Network error");
      } finally {
        setLoading(false);
      }
    };

    fetchAttendance();
    const interval = setInterval(fetchAttendance, 60000);

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === "object" && event.data?.type === "refresh-attendance" && event.data.attendance) {
        setData({ access: "full", attendance: event.data.attendance, counts: event.data.counts, safety: event.data.safety });
        setLoading(false);
        if (event.data.signedRequest) setIsKioskMode(true);
      } else if (event.data === "refresh-attendance") {
        fetchAttendance();
      }
    };
    window.addEventListener("message", handleMessage);

    return () => {
      clearInterval(interval);
      window.removeEventListener("message", handleMessage);
    };
  }, [searchParams]);

  useEffect(() => {
    const performSearch = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/roles`);
        if (res.ok) {
          const data = await res.json();
          const filtered = data.participants.filter(
            (p: Participant) =>
              (p.name || "").toLowerCase().includes((searchQuery || "").toLowerCase()) ||
              (p.email || "").toLowerCase().includes((searchQuery || "").toLowerCase())
          );
          setSearchResults(filtered);
        }
      } catch (error) {
        console.error("Search error:", error);
      }
    };
    const timeoutId = setTimeout(performSearch, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const refreshAttendance = async () => {
    const headers: Record<string, string> = {};
    const sigParamsUrl = searchParams.get("sig");
    const tsParamsUrl = searchParams.get("ts");
    const nonceParamsUrl = searchParams.get("nonce");
    if (sigParamsUrl && tsParamsUrl && nonceParamsUrl) {
      headers["x-kiosk-signature"] = sigParamsUrl;
      headers["x-kiosk-timestamp"] = tsParamsUrl;
      headers["x-kiosk-nonce"] = nonceParamsUrl;
    }
    const attRes = await fetch("/api/attendance", { headers });
    const json = await attRes.json();
    if (attRes.ok && (json.access === "full" || json.access === "limited")) {
      setData(json);
      if (json.signedRequest) setIsKioskMode(true);
    }
  };

  const handleForceCheckout = async (visitId: number, isSelf: boolean = false) => {
    if (!isSelf && !confirm("Are you sure you want to force checkout this user?")) return;
    setCheckingOut(visitId);
    try {
      const res = await fetch("/api/attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId }),
      });
      if (res.ok) refreshAttendance();
      else alert(isSelf ? "Failed to check out." : "Failed to force checkout.");
    } catch (e) {
      console.error(e);
      alert("Network error.");
    } finally {
      setCheckingOut(null);
    }
  };

  const handleManualCheckIn = async (participantId: number) => {
    setCheckingInId(participantId);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId }),
      });
      if (res.ok) {
        setSearchQuery("");
        setSearchResults([]);
        refreshAttendance();
      } else {
        const d = await res.json();
        alert(`Error: ${d.error}`);
      }
    } catch (e) {
      console.error(e);
      alert("Network error.");
    } finally {
      setCheckingInId(null);
    }
  };

  const checkedInIds = isFull
    ? fullAttendance.map(v => v.participant.id)
    : [...limitedHousehold.map(v => v.participant.id), ...(limitedSelf ? [limitedSelf.participant.id] : [])];
  const displayResults = searchResults.filter(p => !checkedInIds.includes(p.id));

  const kioskDisplayNames = useMemo(() => {
    if (!isKioskMode) return new Map<number, string>();
    const allVisits = [...keyholderList, ...volunteerList, ...studentList];
    return getKioskDisplayNames(allVisits.map(v => ({ id: v.participant.id, name: v.participant.name || null, email: v.participant.email })));
  }, [isKioskMode, keyholderList, volunteerList, studentList]);

  const canSeeNames = !isKioskMode && (currentUserIsKeyholder || currentUserIsSysadmin || currentUserIsBoardMember);

  const renderPersonCard = (visit: Visit, showCheckout: boolean) => {
    const hue = visit.event?.program?.name
      ? visit.event.program.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360
      : 0;
    return (
      <Paper key={visit.id} withBorder radius="sm" p="xs">
        <Group justify="space-between" wrap="nowrap">
          <Box style={{ overflow: "hidden" }}>
            <Text
              fw={500} size="sm" truncate
              style={{ cursor: canSeeNames ? 'pointer' : 'default' }}
              onClick={() => { if (canSeeNames) setSelectedParticipant(visit.participant); }}
            >
              {isKioskMode ? (kioskDisplayNames.get(visit.participant.id) || visit.participant.name || visit.participant.email.split("@")[0]) : (visit.participant.name || visit.participant.email.split("@")[0])}
            </Text>
            <Group gap={6} align="center">
              <Text c="dimmed" size="xs">{formatTime(visit.arrived)}</Text>
              {visit.event?.program?.name && (
                <Badge size="xs" variant="light" style={{ background: `hsl(${hue}, 60%, 20%)`, color: `hsl(${hue}, 80%, 80%)` }} title={visit.event.program.name}>
                  {visit.event.program.name}
                </Badge>
              )}
            </Group>
            {!isKioskMode && (currentUserIsKeyholder || currentUserIsSysadmin) && visit.participant.phone && (
              <Text size="xs" c="blue">📞 {visit.participant.phone}</Text>
            )}
          </Box>
          {showCheckout && (
            <Button size="compact-xs" color="red" variant="light" onClick={() => handleForceCheckout(visit.id, visit.participant.id === (session?.user as SessionUser)?.id)} disabled={checkingOut === visit.id}>
              {checkingOut === visit.id ? "..." : "Out"}
            </Button>
          )}
        </Group>
      </Paper>
    );
  };

  const canCheckoutVisit = (visit: Visit): boolean => Boolean(
    visit.participant.id === (session?.user as SessionUser)?.id ||
    (household?.leads?.some((l) => l.participantId === (session?.user as SessionUser)?.id) &&
      visit.participant.householdId === currentUserHouseholdId)
  );

  const renderColumn = (icon: string, count: number, label: string, color: string, list: Visit[]) => (
    <div>
      <Group gap={8} mb="sm" pb="xs" style={{ borderBottom: `2px solid var(--mantine-color-${color}-5)` }}>
        <Text fz="xl">{icon}</Text>
        <div>
          <Text fz="xl" fw={800} c={color} lh={1}>{count}</Text>
          <Text size="xs" tt="uppercase" c="dimmed">{label}</Text>
        </div>
      </Group>
      <SimpleGrid cols={list.length > 10 ? 2 : 1} spacing="xs">
        {list.map(v => renderPersonCard(v, canCheckoutVisit(v)))}
      </SimpleGrid>
    </div>
  );

  const userId = (session?.user as SessionUser)?.id;

  return (
    <Box p="md" style={isKioskMode ? { cursor: "none" } : undefined}>
      {!isKioskMode && (
        <Box style={{ maxWidth: 1200, margin: "0 auto" }}>
          <AttendanceTabs />
        </Box>
      )}
      <Card withBorder radius="md" padding="lg" style={{ width: "100%", maxWidth: 1200, margin: "0 auto" }}>
        {/* Check-in button — hidden in kiosk mode */}
        {!isKioskMode && (
          <Box mb="lg">
            {!isCheckedIn ? (
              <Button
                fullWidth size="md"
                onClick={() => { if (userId) handleManualCheckIn(userId); }}
                disabled={checkingInId === userId}
                loading={checkingInId === userId}
              >
                Check Me In
              </Button>
            ) : (
              <Alert color="teal" ta="center">You are currently checked in!</Alert>
            )}
          </Box>
        )}

        {/* Header */}
        <Group justify="space-between" align="center" wrap="wrap" mb="lg">
          <Title order={1}>Current Attendance</Title>
          <Group align="center" gap="md" wrap="wrap">
            {!isKioskMode && canAdminCheckout && (
              <Button color="red" variant="light" radius="xl" size="xs" fz={15} onClick={() => setShowSignOutModal(true)}>
                Sign out a user
              </Button>
            )}
            <Badge size="lg" color="teal" variant="light" leftSection="●">{counts.total} People Present</Badge>
          </Group>
        </Group>

        {/* Household check-in buttons — hidden in kiosk mode */}
        {!isKioskMode && canCheckInHousehold && household && household.leads?.some((l) => l.participantId === userId) && (
          <Box mb="lg">
            <Title order={4} c="blue" mb="sm">Check In Household Members</Title>
            <Group gap="xs" wrap="wrap">
              {household.participants?.filter((p) => !checkedInIds.includes(p.id)).map((p) => (
                <Button key={p.id} variant="default" onClick={() => handleManualCheckIn(p.id)} disabled={checkingInId === p.id}>
                  {checkingInId === p.id ? "..." : (p.name || p.email)}
                </Button>
              ))}
              {household.participants?.filter((p) => !checkedInIds.includes(p.id)).length === 0 && (
                <Text c="dimmed" fs="italic" size="sm">All household members are currently checked in!</Text>
              )}
            </Group>
          </Box>
        )}

        {/* Admin manual check-in search — hidden in kiosk mode */}
        {!isKioskMode && canManuallyCheckInGlobal && (
          <Box mb="lg" pos="relative">
            <TextInput
              placeholder="Manually check someone in (Search by name or email)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
            />
            {displayResults.length > 0 && searchQuery.length >= 2 && (
              <Paper withBorder shadow="md" radius="sm" pos="absolute" left={0} right={0} style={{ zIndex: 10, maxHeight: 200, overflowY: "auto" }}>
                {displayResults.map((p) => (
                  <Group key={p.id} justify="space-between" p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                    <div>
                      <Text fw={500}>{p.name || "Unnamed"}</Text>
                      <Text size="xs" c="dimmed">{p.email}</Text>
                    </div>
                    <Button size="compact-xs" variant="light" disabled={checkingInId === p.id} onClick={() => handleManualCheckIn(p.id)}>
                      {checkingInId === p.id ? "..." : "Check In"}
                    </Button>
                  </Group>
                ))}
              </Paper>
            )}
          </Box>
        )}

        {/* Safety warnings */}
        {safety.isTwoDeepViolation && (
          <Alert color="red" icon="🚨" title="Critical Warning" mb="lg">
            Two-Deep Compliance is failing! An unaccompanied student is present without sufficient
            adult supervision.
          </Alert>
        )}
        {!safety.isTwoDeepViolation && safety.isLastKeyholder && (
          <Alert color="yellow" icon="⚠️" title="Warning" mb="lg">
            Only one keyholder is currently in the building.
          </Alert>
        )}

        {/* Main content */}
        {loading ? (
          <Center py="xl"><Loader /></Center>
        ) : error ? (
          <Alert color="red">{error === "Unauthorized" ? "Access Denied: Please sign in to view attendance." : error}</Alert>
        ) : counts.total === 0 ? (
          <Center py="xl"><Text c="dimmed">The facility is currently empty.</Text></Center>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {renderColumn("🔑", counts.keyholders, "Keyholders", "blue", isFull ? keyholderList : householdKeyholders)}
            {renderColumn("🤝", counts.volunteers, "Volunteers", "teal", isFull ? volunteerList : householdVolunteers)}
            {renderColumn("🎓", counts.students, "Students", "grape", isFull ? studentList : householdStudents)}
          </SimpleGrid>
        )}

        {/* Privacy notice for limited access */}
        {!isFull && counts.total > 0 && (
          <Paper withBorder radius="md" p="sm" mt="lg" ta="center">
            <Text size="sm" c="dimmed">
              🔒 Individual names are only visible to administrators and on the facility kiosk.
              {limitedHousehold.length > 0 && " Your household members are shown above."}
            </Text>
          </Paper>
        )}
      </Card>

      {/* Admin Sign Out Modal */}
      <Modal opened={showSignOutModal} onClose={() => setShowSignOutModal(false)} title={<Title order={4}>Sign Out A User</Title>} size="lg">
        <TextInput
          placeholder="Search checked-in users..."
          value={searchSignOutQuery}
          onChange={(e) => setSearchSignOutQuery(e.currentTarget.value)}
          data-autofocus
          mb="md"
        />
        <Stack gap="xs" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {fullAttendance.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">No one is checked in.</Text>
          ) : (
            fullAttendance
              .filter(v => ((v.participant.name || "").toLowerCase().includes((searchSignOutQuery || "").toLowerCase()) || (v.participant.email || "").toLowerCase().includes((searchSignOutQuery || "").toLowerCase())))
              .sort((a, b) => (a.participant.name || "").localeCompare(b.participant.name || ""))
              .map(v => (
                <Paper key={v.id} withBorder radius="md" p="sm">
                  <Group justify="space-between">
                    <div>
                      <Text fw={500}>{v.participant.name || v.participant.email.split('@')[0]}</Text>
                      <Text size="xs" c="dimmed">Arrived: {formatTime(v.arrived)}</Text>
                    </div>
                    <Button color="red" variant="light" onClick={() => handleForceCheckout(v.id)} disabled={checkingOut === v.id}>
                      {checkingOut === v.id ? "Signing Out..." : "Sign Out"}
                    </Button>
                  </Group>
                </Paper>
              ))
          )}
        </Stack>
      </Modal>

      {/* Emergency Contact Modal */}
      <Modal
        opened={!!selectedParticipant}
        onClose={() => setSelectedParticipant(null)}
        title={<Title order={4} c="yellow">🆘 Emergency Contact Info</Title>}
        centered
      >
        {selectedParticipant && (
          <>
            <Stack align="center" gap={4} mb="lg">
              <Text fz="xl" fw={700}>{selectedParticipant.name || selectedParticipant.email.split('@')[0]}</Text>
              {selectedParticipant.phone && (
                <Text c="dimmed">User Phone: <Anchor href={`tel:${selectedParticipant.phone.replace(/\D/g, '')}`} c="teal">{selectedParticipant.phone}</Anchor></Text>
              )}
            </Stack>
            <Alert color="red" variant="light" ta="center">
              {selectedParticipant.household?.emergencyContacts && selectedParticipant.household.emergencyContacts.length > 0 ? (
                <Stack gap="md">
                  <Text size="sm" c="dimmed" tt="uppercase">Emergency Contact{selectedParticipant.household.emergencyContacts.length > 1 ? "s" : ""}</Text>
                  {selectedParticipant.household.emergencyContacts.map((c) => (
                    <div key={c.id}>
                      <Text fz="lg" fw={700} mb="xs">
                        {c.name}{c.relationship ? <Text component="span" c="dimmed" fz="sm"> ({c.relationship})</Text> : null}
                      </Text>
                      <Anchor href={`tel:${c.phone.replace(/\D/g, '')}`} c="red" fz="xl">
                        📞 {c.phone}
                      </Anchor>
                    </div>
                  ))}
                </Stack>
              ) : (
                <>
                  <Text fw={700} mb={4}>No Emergency Contact on File</Text>
                  <Text size="sm" c="dimmed">This user&apos;s household has not registered an emergency contact.</Text>
                </>
              )}
            </Alert>
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={() => setSelectedParticipant(null)}>Close</Button>
            </Group>
          </>
        )}
      </Modal>
    </Box>
  );
}

export default function KioskDisplay() {
  return (
    <Suspense fallback={<Center mih="100vh"><Loader /></Center>}>
      <KioskDisplayInner />
    </Suspense>
  );
}
