"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, Center, Checkbox, Container, Group, Loader, Paper, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { formatDate, formatTime, formatDateTime } from '@/lib/time';
import TrustedAdultPanel from '@/components/TrustedAdultPanel';
import TodoCard from '@/components/TodoCard';
import { notifyNavRefresh } from '@/lib/nav-refresh';

type Member = { id: number; name?: string; email?: string; dob?: string; phone?: string };
type EmergencyContact = { id: number; name: string; phone: string; email?: string | null; relationship?: string | null; priority: number; invalid: boolean };
type HouseholdData = {
  id?: number;
  name?: string;
  leads?: Array<{ participantId: number }>;
  participants?: Member[];
  membership?: { status?: string; since?: string; isVolunteer?: boolean } | null;
  address?: string;
} | null;

const blankContactForm = { id: null as number | null, name: "", phone: "", email: "", relationship: "" };
type Visit = { id: number; participant?: { name: string }; event?: { name: string }; arrived: string; departed?: string };

export default function HouseholdPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<HouseholdData>(null);
  const [message, setMessage] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const [memberForm, setMemberForm] = useState({ name: "", email: "", dob: "" });

  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", dob: "", phone: "", isLead: false });

  const [visits, setVisits] = useState<Visit[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [settings, setSettings] = useState({ emailDependentCheckins: false });
  const [address, setAddress] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [contactForm, setContactForm] = useState(blankContactForm);
  const [showContactForm, setShowContactForm] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  // Errors specific to the emergency-contact card render inline next to the form,
  // not in the page-top banner which is far off-screen from this section.
  const [contactError, setContactError] = useState("");

  const fetchContacts = useCallback(async () => {
    const res = await fetch('/api/household/emergency-contacts');
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts || []);
    }
  }, []);

  const fetchHousehold = useCallback(async () => {
    try {
      const [res, visitRes, profileRes] = await Promise.all([
        fetch('/api/household'),
        fetch(`/api/household/visits?date=${filterDate}`),
        fetch('/api/profile')
      ]);
      if (res.ok) {
        const data = await res.json();
        setHousehold(data.household);
        setAddress(data.household?.address || "");
      }
      if (visitRes.ok) {
        const data = await visitRes.json();
        setVisits(data.visits || []);
      }
      if (profileRes.ok) {
        const data = await profileRes.json();
        setSettings({ emailDependentCheckins: data.profile.notificationSettings?.emailDependentCheckins || false });
      }
    } catch {
      setMessage("Network error loading household.");
    } finally {
      setLoading(false);
    }
  }, [filterDate]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    } else if (status === "authenticated") {
      fetchHousehold();
      fetchContacts();
    }
  }, [status, router, fetchHousehold, fetchContacts]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const profileRes = await fetch('/api/profile');
      const profileData = await profileRes.json();
      const currentSettings = profileData.profile?.notificationSettings || {};

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationSettings: { ...currentSettings, emailDependentCheckins: settings.emailDependentCheckins } })
      });
      const householdRes = await fetch('/api/household/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });

      if (res.ok && householdRes.ok) {
        setMessage("Settings updated successfully!");
        fetchHousehold();
        notifyNavRefresh();
      } else {
        setMessage("Failed to update some settings.");
      }
    } catch {
      setMessage("Network error saving settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingContact(true);
    setContactError("");
    try {
      const editing = contactForm.id !== null;
      const url = editing ? `/api/household/emergency-contacts/${contactForm.id}` : '/api/household/emergency-contacts';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: contactForm.name, phone: contactForm.phone, email: contactForm.email, relationship: contactForm.relationship }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(editing ? "Emergency contact updated." : "Emergency contact added.");
        setContactForm(blankContactForm);
        setShowContactForm(false);
        fetchContacts();
      } else {
        setContactError(data.error || "Failed to save emergency contact.");
      }
    } catch {
      setContactError("Network error saving emergency contact.");
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    setContactError("");
    try {
      const res = await fetch(`/api/household/emergency-contacts/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage("Emergency contact removed.");
        fetchContacts();
      } else {
        setContactError(data.error || "Failed to remove emergency contact.");
      }
    } catch {
      setContactError("Network error removing emergency contact.");
    }
  };

  const startAddContact = () => {
    setContactError("");
    setContactForm(blankContactForm);
    setShowContactForm(true);
  };
  // Direction-B: a member change collided with an emergency contact. Surface the
  // warning and drop the lead straight into the add-contact form.
  const applyContactWarning = (warning?: { message: string } | null) => {
    if (!warning) return false;
    setMessage(`⚠️ ${warning.message}`);
    fetchContacts();
    startAddContact();
    return true;
  };
  const startEditContact = (c: EmergencyContact) => {
    setContactError("");
    setContactForm({ id: c.id, name: c.name, phone: c.phone, email: c.email || "", relationship: c.relationship || "" });
    setShowContactForm(true);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch('/api/household', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberName: memberForm.name, memberEmail: memberForm.email, memberDob: memberForm.dob })
      });
      const data = await res.json();
      if (res.ok) {
        setMemberForm({ name: "", email: "", dob: "" });
        setAddingMember(false);
        fetchHousehold();
        if (!applyContactWarning(data.warning)) setMessage(data.message || "Member added successfully!");
      } else {
        setMessage(data.error || "Failed to add member.");
      }
    } catch {
      setMessage("Network error adding member.");
    }
  };

  const handleEditMember = async (e: React.FormEvent, participantId: number) => {
    e.preventDefault();
    setMessage("");
    try {
      const res = await fetch('/api/household/member', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, name: editForm.name, email: editForm.email, dob: editForm.dob, phone: editForm.phone, isLead: editForm.isLead })
      });
      const data = await res.json();
      if (res.ok) {
        setEditingMemberId(null);
        fetchHousehold();
        // A member edit can both collide with an emergency contact (warning,
        // which also opens the add-contact flow) and be declined the lead
        // promotion (leadRejection). Surface the contact warning first since
        // it's the more urgent, then the lead caveat, else a plain success.
        if (!applyContactWarning(data.warning)) {
          setMessage(data.leadRejection
            ? `Member updated, but not added as a lead — ${data.leadRejection}`
            : (data.message || "Member updated successfully!"));
        }
      } else {
        setMessage(data.error || "Failed to update member.");
      }
    } catch {
      setMessage("Network error updating member.");
    }
  };

  const handleMakeLead = async (participantId: number) => {
    setMessage("");
    try {
      const res = await fetch('/api/household/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId }) });
      const data = await res.json();
      if (res.ok) {
        setMessage("Member promoted to lead successfully!");
        fetchHousehold();
      } else {
        setMessage(data.error || "Failed to promote member.");
      }
    } catch {
      setMessage("Network error promoting member.");
    }
  };

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!session) return null;

  const userId = (session.user as { id: number })?.id;
  const isLead = (pid: number) => household?.leads?.some((l) => l.participantId === pid) ?? false;
  const viewerIsLead = isLead(userId);

  const sortedMembers = (household?.participants || []).slice().sort((a, b) => {
    const isLeadA = isLead(a.id) ? 1 : 0;
    const isLeadB = isLead(b.id) ? 1 : 0;
    if (isLeadA !== isLeadB) return isLeadB - isLeadA;
    if (a.dob && b.dob) return new Date(a.dob).getTime() - new Date(b.dob).getTime();
    if (a.dob) return -1;
    if (b.dob) return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return (
    <Container size="md" py="md">
      <Stack>
        <TodoCard />
        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" align="center" wrap="wrap" mb="md">
            <Title order={1}>{household?.name || 'My Household'}</Title>
            <Button variant="default" onClick={() => router.push('/')}>← Back</Button>
          </Group>

          {household && (
            household.membership?.status === 'ACTIVE' ? (
              <Alert color="green" mb="lg">
                <Group gap="xs" wrap="wrap">
                  <Text fw={600}>✓ Member{household.membership.since ? ` since ${formatDate(household.membership.since)}` : ''}</Text>
                  {household.membership.isVolunteer && <Badge color="green" variant="light">Volunteer-only family</Badge>}
                </Group>
              </Alert>
            ) : (
              <Alert color="blue" mb="lg">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Text c="dimmed">Your household isn&apos;t a member yet.</Text>
                  <Button size="xs" onClick={() => router.push('/membership')}>Join the Treehouse!</Button>
                </Group>
              </Alert>
            )
          )}

          {message && <Alert color={message.includes('success') ? 'green' : 'red'} mb="lg">{message}</Alert>}

          {!household ? (
            <Stack align="center" py="md">
              <Text c="dimmed" ta="center">
                We couldn&apos;t load your household. Please refresh to try again.
              </Text>
            </Stack>
          ) : (
            <>
              <Title order={3} mb="md">Household Members</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} mb="lg">
                {sortedMembers.map((p) => {
                  const memberIsLead = isLead(p.id);
                  const isAdult = p.dob && (new Date().getFullYear() - new Date(p.dob).getFullYear() >= 18);
                  return (
                    <Card key={p.id} withBorder radius="md" padding="md">
                      {editingMemberId === p.id ? (
                        <form onSubmit={(e) => handleEditMember(e, p.id)}>
                          <Stack gap="xs">
                            <TextInput size="xs" label="Name" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.currentTarget.value })} />
                            <TextInput size="xs" type="email" label="Email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.currentTarget.value })} />
                            <TextInput size="xs" type="date" label="Date of Birth" value={editForm.dob} onChange={(e) => setEditForm({ ...editForm, dob: e.currentTarget.value })} />
                            <TextInput size="xs" type="tel" label="Phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.currentTarget.value })} />
                            {p.id !== userId && editForm.dob && (new Date().getFullYear() - new Date(editForm.dob).getFullYear() >= 18) && (
                              <Checkbox label="Household Lead" checked={editForm.isLead} onChange={(e) => setEditForm({ ...editForm, isLead: e.currentTarget.checked })} />
                            )}
                            <Group gap="xs">
                              <Button type="submit" size="xs" color="green">Save</Button>
                              <Button type="button" size="xs" variant="default" onClick={() => setEditingMemberId(null)}>Cancel</Button>
                            </Group>
                          </Stack>
                        </form>
                      ) : (
                        <>
                          <Text fw={600} style={{ wordBreak: 'break-word' }}>{p.name || "Unnamed"}</Text>
                          {p.email && <Text size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>{p.email}</Text>}
                          {p.phone && <Text size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>{p.phone}</Text>}
                          <Group gap="xs" mt="sm">
                            {memberIsLead && <Badge color="grape" variant="light">Household Lead</Badge>}
                            {!memberIsLead && isAdult && viewerIsLead && (
                              <Button size="compact-xs" variant="light" onClick={() => handleMakeLead(p.id)}>Make Lead</Button>
                            )}
                            {viewerIsLead && (
                              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => {
                                setEditingMemberId(p.id);
                                setEditForm({ name: p.name || "", email: p.email || "", dob: p.dob ? new Date(p.dob).toISOString().split('T')[0] : "", phone: p.phone || "", isLead: memberIsLead });
                              }}>Edit</Button>
                            )}
                          </Group>
                        </>
                      )}
                    </Card>
                  );
                })}
              </SimpleGrid>

              {!addingMember ? (
                <Button variant="light" onClick={() => setAddingMember(true)}>+ Add Household Member</Button>
              ) : (
                <Card withBorder radius="md" padding="lg">
                  <form onSubmit={handleAddMember}>
                    <Title order={4}>Household Member Registration</Title>
                    <Text c="dimmed" size="sm" mb="lg">
                      If you enter an email address, their account will be correctly linked to this
                      household the first time they log in via Google. Leave the email blank if they
                      are a student dependent who will not sign in themselves.
                    </Text>
                    <Stack>
                      <TextInput label="Full Name" required value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.currentTarget.value })} />
                      <TextInput type="email" label="Email (Optional)" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.currentTarget.value })} placeholder="spouse@example.com" />
                      <TextInput type="date" label="Date of Birth (Optional)" value={memberForm.dob} onChange={(e) => setMemberForm({ ...memberForm, dob: e.currentTarget.value })} />
                      <Group grow>
                        <Button type="submit" color="green">Save / Invite Member</Button>
                        <Button type="button" variant="default" onClick={() => setAddingMember(false)}>Cancel</Button>
                      </Group>
                    </Stack>
                  </form>
                </Card>
              )}
            </>
          )}
        </Card>

        {household && viewerIsLead && (
          <Card withBorder radius="md" padding="lg">
            <Title order={3} mb="md">Household Settings</Title>
            <Stack>
              <Checkbox
                checked={settings.emailDependentCheckins}
                onChange={(e) => setSettings({ ...settings, emailDependentCheckins: e.currentTarget.checked })}
                label="Email me realtime receipts when my dependents check in/out"
              />

              <Card withBorder radius="md" padding="md">
                <Title order={5} c="blue">Primary Address</Title>
                <Text size="sm" c="dimmed" mb="sm">The main address associated with this household.</Text>
                <TextInput label="Address" value={address} onChange={(e) => setAddress(e.currentTarget.value)} placeholder="123 Main St, City, ST 12345" />
              </Card>

              <Card withBorder radius="md" padding="md" id="emergency-contact" style={{ scrollMarginTop: 80 }}>
                <Group justify="space-between" align="center" mb="xs">
                  <Title order={5} c="yellow">Emergency Contacts</Title>
                  {!showContactForm && <Button size="compact-xs" variant="light" onClick={startAddContact}>+ Add Contact</Button>}
                </Group>
                <Text size="sm" c="dimmed" mb="sm">
                  At least one is required. Each must be someone <strong>outside</strong> this household.
                </Text>

                {contactError && (
                  <Alert color="red" variant="light" mb="sm" withCloseButton onClose={() => setContactError("")}>{contactError}</Alert>
                )}

                {contacts.length === 0 && !showContactForm && (
                  <Alert color="red" variant="light">No emergency contact on file. Add at least one.</Alert>
                )}

                <Stack gap="xs">
                  {contacts.map((c) => {
                    // Can't remove the only valid contact — a household must keep at least one.
                    const validCount = contacts.filter((x) => !x.invalid).length;
                    const isLastValid = !c.invalid && validCount <= 1;
                    return (
                    <Paper key={c.id} withBorder radius="sm" p="sm" bg={c.invalid ? 'var(--mantine-color-red-light)' : undefined}>
                      <Group justify="space-between" wrap="nowrap">
                        <div>
                          <Group gap="xs">
                            <Text fw={600}>{c.name || "Unnamed"}</Text>
                            {c.relationship && <Badge variant="light" color="gray">{c.relationship}</Badge>}
                            {c.invalid && <Badge variant="light" color="red">Invalid — is a household member</Badge>}
                          </Group>
                          <Text size="sm" c="dimmed">{c.phone}{c.email ? ` • ${c.email}` : ''}</Text>
                        </div>
                        <Group gap="xs" wrap="nowrap">
                          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => startEditContact(c)}>Edit</Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="red"
                            disabled={isLastValid}
                            title={isLastValid ? "Add a second emergency contact before removing this one." : undefined}
                            onClick={() => handleDeleteContact(c.id)}
                          >Remove</Button>
                        </Group>
                      </Group>
                    </Paper>
                    );
                  })}
                </Stack>

                {showContactForm && (
                  <form onSubmit={handleSaveContact}>
                    <Stack gap="xs" mt="sm">
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput label="Contact Name" required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.currentTarget.value })} placeholder="Full Name" />
                        <TextInput type="tel" label="Phone" required value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.currentTarget.value })} placeholder="(555) 555-5555" />
                        <TextInput type="email" label="Email (optional)" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.currentTarget.value })} />
                        <TextInput label="Relationship (optional)" value={contactForm.relationship} onChange={(e) => setContactForm({ ...contactForm, relationship: e.currentTarget.value })} placeholder="Aunt, Neighbor…" />
                      </SimpleGrid>
                      <Group gap="xs">
                        <Button type="submit" size="xs" color="green" loading={savingContact}>{contactForm.id !== null ? "Save Contact" : "Add Contact"}</Button>
                        <Button type="button" size="xs" variant="default" onClick={() => { setShowContactForm(false); setContactForm(blankContactForm); setContactError(""); }}>Cancel</Button>
                      </Group>
                    </Stack>
                  </form>
                )}
              </Card>

              <Card withBorder radius="md" padding="md">
                <Title order={5} c="grape" mb="sm">Trusted Adults</Title>
                <TrustedAdultPanel />
              </Card>
            </Stack>
            <Button onClick={handleSaveSettings} disabled={savingSettings} loading={savingSettings} color="green" fullWidth mt="lg">
              Update Household Settings
            </Button>
          </Card>
        )}

        {household && (
          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" align="center" wrap="wrap" mb="xs">
              <Title order={3}>Household Check-ins</Title>
              <TextInput
                type="date"
                label="Lookup Date"
                size="xs"
                value={filterDate || new Date().toISOString().split('T')[0]}
                onChange={(e) => setFilterDate(e.currentTarget.value)}
              />
            </Group>

            <Text size="sm" c="dimmed" mb="lg">
              {filterDate ? (
                <>Showing activity from <strong>{formatDate(new Date(filterDate).getTime() - 7 * 24 * 60 * 60 * 1000)}</strong> to <strong>{formatDate(new Date(filterDate).getTime() + 7 * 24 * 60 * 60 * 1000)}</strong></>
              ) : (
                <>Showing activity for the <strong>past 7 days</strong></>
              )}
            </Text>

            {visits.length === 0 ? (
              <Text c="dimmed">No historical visits found for your household.</Text>
            ) : (
              <Stack gap="xs">
                {visits.map((v) => (
                  <Paper key={v.id} withBorder radius="md" p="md">
                    <Group justify="space-between">
                      <div>
                        <Text fw={600} c="blue">{v.participant?.name || 'Unnamed Member'}</Text>
                        <Text size="sm" component="span">{v.event?.name || 'General Facility Visit'} </Text>
                        <Text size="sm" c="dimmed" component="span">• {formatDateTime(v.arrived)}</Text>
                      </div>
                      <Text size="sm">
                        {v.departed ? (
                          <Text component="span" c="green">Departed {formatTime(v.departed)}</Text>
                        ) : (
                          <Text component="span" c="yellow">Active Visit</Text>
                        )}
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Card>
        )}
      </Stack>
    </Container>
  );
}
