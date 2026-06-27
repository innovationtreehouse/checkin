"use client";

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert, Anchor, Button, Card, Center, Collapse, Container, Group, Loader,
  Modal, Select, Stack, Table, Tabs, Text, TextInput, Title,
} from '@mantine/core';
import { ToolLevelBadge, toToolLevel } from '@/components/ToolLevelBadge';

type Tool = {
  id: number;
  name: string;
  safetyGuide: string | null;
  _count?: { toolStatuses: number };
};

type Certification = {
  userId: number;
  toolId: number;
  level: "BASIC" | "DOF" | "CERTIFIED" | "INSTRUCTOR" | "MAY_CERTIFY_OTHERS";
  user?: { id: number; name: string | null; email: string };
  tool?: { id: number; name: string };
};

type Member = { id: number; name: string | null; email: string };

type Tab = 'tools' | 'person' | 'all';

const LEVEL_OPTIONS = [
  { value: 'BASIC', label: 'Basic' },
  { value: 'CERTIFIED', label: 'Certified' },
  { value: 'DOF', label: 'DoF' },
  { value: 'INSTRUCTOR', label: 'Instructor' },
  { value: 'MAY_CERTIFY_OTHERS', label: 'Certifier' },
];

function GrantForm({
  tools, members, prefillToolId, prefillMemberId, onGranted, saving, setSaving, canGrantCertifier,
}: {
  tools: Tool[];
  members: Member[];
  prefillToolId?: number;
  prefillMemberId?: number;
  onGranted: (msg: string) => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
  // Only admins/board may grant the Certifier (MAY_CERTIFY_OTHERS) level.
  canGrantCertifier: boolean;
}) {
  // Tool certifiers can grant up to (but not including) Certifier; the backend
  // enforces this too — this just keeps the option out of their dropdown.
  const levelOptions = canGrantCertifier
    ? LEVEL_OPTIONS
    : LEVEL_OPTIONS.filter(o => o.value !== 'MAY_CERTIFY_OTHERS');
  const [toolId, setToolId] = useState(prefillToolId?.toString() ?? "");
  const [memberId, setMemberId] = useState(prefillMemberId?.toString() ?? "");
  const [level, setLevel] = useState("CERTIFIED");
  const [confirm, setConfirm] = useState<null | { toolName: string; userName: string; newLevel: string; payload: object }>(null);

  const selectedTool = tools.find(t => t.id === parseInt(toolId));
  const selectedMember = members.find(m => m.id === parseInt(memberId));

  const initiate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!toolId || !memberId || !level) return;
    setConfirm({
      toolName: selectedTool?.name ?? '?',
      userName: selectedMember?.name ?? selectedMember?.email ?? '?',
      newLevel: level,
      payload: { toolId: parseInt(toolId), participantId: parseInt(memberId), level },
    });
  };

  const confirm_ = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      const res = await fetch('/api/shop/certifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirm.payload),
      });
      const data = await res.json();
      if (res.ok) {
        onGranted(`Certification updated for ${confirm.userName} on ${confirm.toolName}.`);
        setMemberId(prefillMemberId?.toString() ?? "");
        setToolId(prefillToolId?.toString() ?? "");
      } else {
        onGranted(data.error ?? 'Failed.');
      }
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <form onSubmit={initiate}>
        <Group align="flex-end" gap="sm" wrap="wrap">
          {!prefillToolId && (
            <Select
              label="Tool" required style={{ flex: '1 1 180px' }}
              placeholder="-- Tool --"
              value={toolId} onChange={(v) => setToolId(v ?? "")}
              data={tools.map(t => ({ value: String(t.id), label: t.name }))}
            />
          )}
          {!prefillMemberId && (
            <Select
              label="Member" required style={{ flex: '1 1 180px' }} searchable
              placeholder="-- Member --"
              value={memberId} onChange={(v) => setMemberId(v ?? "")}
              data={members.map(m => ({ value: String(m.id), label: m.name ?? m.email }))}
            />
          )}
          <Select label="Level" w={140} value={level} onChange={(v) => setLevel(v ?? "CERTIFIED")} allowDeselect={false} data={levelOptions} />
          <Button type="submit" color="green" disabled={saving}>Grant</Button>
        </Group>
      </form>

      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title="Confirm Certification" centered>
        <Text mb="lg">
          Grant <strong>{confirm?.newLevel}</strong> on <strong>{confirm?.toolName}</strong> to <strong>{confirm?.userName}</strong>?
        </Text>
        <Group grow>
          <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="green" onClick={confirm_} disabled={saving} loading={saving}>Confirm</Button>
        </Group>
      </Modal>
    </>
  );
}

// ---- Tools tab ----

function ToolsTab({ tools, members, isAdmin, isCertifier, onToolsChange }: {
  tools: Tool[];
  members: Member[];
  isAdmin: boolean;
  isCertifier: boolean;
  onToolsChange: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [editingGuide, setEditingGuide] = useState<{ id: number; value: string } | null>(null);
  const [savingGuide, setSavingGuide] = useState(false);
  const [msg, setMsg] = useState("");
  const [grantMsg, setGrantMsg] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = async (toolId: number) => {
    if (expanded === toolId) { setExpanded(null); setCerts([]); return; }
    setExpanded(toolId);
    setLoadingCerts(true);
    try {
      const res = await fetch(`/api/shop/certifications?toolId=${toolId}`);
      if (res.ok) setCerts(await res.json());
    } finally {
      setLoadingCerts(false);
    }
  };

  const saveGuide = async () => {
    if (!editingGuide) return;
    setSavingGuide(true);
    try {
      const res = await fetch(`/api/shop/tools/${editingGuide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ safetyGuide: editingGuide.value }),
      });
      if (res.ok) {
        setMsg("Safety guide updated.");
        setEditingGuide(null);
        onToolsChange();
        if (expanded === editingGuide.id) {
          const toolRes = await fetch(`/api/shop/certifications?toolId=${editingGuide.id}`);
          if (toolRes.ok) setCerts(await toolRes.json());
        }
      } else {
        setMsg("Failed to update.");
      }
    } finally {
      setSavingGuide(false);
    }
  };

  const filtered = tools.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      {msg && <Alert color="cyan" mb="md">{msg}</Alert>}

      <Group mb="md" align="center" wrap="wrap">
        <TextInput placeholder="Search tools..." value={search} onChange={e => setSearch(e.currentTarget.value)} style={{ flex: '1 1 220px' }} />
      </Group>

      {filtered.length === 0 && <Text c="dimmed">No tools match.</Text>}

      <Stack gap="xs">
        {filtered.map((tool) => {
          const isOpen = expanded === tool.id;
          return (
            <Card key={tool.id} withBorder radius="md" padding={0} style={isOpen ? { borderColor: 'var(--mantine-color-cyan-5)' } : undefined}>
              <Group gap="md" p="md" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => toggle(tool.id)}>
                <Text fw={600} c={isOpen ? 'cyan' : undefined} style={{ flex: 1 }}>{tool.name}</Text>
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{tool._count?.toolStatuses ?? '?'} certified</Text>
                {tool.safetyGuide ? (
                  <Anchor href={tool.safetyGuide} target="_blank" rel="noopener noreferrer" size="sm" onClick={(e) => e.stopPropagation()}>Safety Guide ↗</Anchor>
                ) : (
                  <Text size="sm" c="dimmed">No guide</Text>
                )}
                {isAdmin && (
                  <Button size="compact-xs" variant="default" onClick={(e) => { e.stopPropagation(); setEditingGuide({ id: tool.id, value: tool.safetyGuide ?? '' }); setMsg(""); }}>
                    Edit guide
                  </Button>
                )}
                <Text c="dimmed" size="sm">{isOpen ? '▲' : '▼'}</Text>
              </Group>

              <Collapse in={isOpen}>
                <Card.Section withBorder p="md">
                  {loadingCerts ? <Center py="sm"><Loader size="sm" /></Center> : (
                    <>
                      <Text fw={600} size="sm" c="dimmed" mb="sm">Certified members</Text>
                      {certs.length === 0 ? (
                        <Text c="dimmed" size="sm">No certifications yet.</Text>
                      ) : (
                        <Stack gap={6} mb="md">
                          {certs.map((c) => (
                            <Group key={`${c.userId}-${c.toolId}`} justify="space-between" p="xs" style={{ borderRadius: 6, background: 'var(--mantine-color-default-hover)' }}>
                              <Text size="sm">{c.user?.name ?? 'Unnamed'} <Text component="span" c="dimmed" size="xs">({c.user?.email})</Text></Text>
                              <ToolLevelBadge level={toToolLevel(c.level)} />
                            </Group>
                          ))}
                        </Stack>
                      )}
                      {isCertifier && (
                        <>
                          {grantMsg && <Text size="sm" c="cyan" mb="sm">{grantMsg}</Text>}
                          <GrantForm tools={tools} members={members} prefillToolId={tool.id}
                            canGrantCertifier={isAdmin}
                            onGranted={m => { setGrantMsg(m); toggle(tool.id).then(() => toggle(tool.id)); }}
                            saving={grantSaving} setSaving={setGrantSaving} />
                        </>
                      )}
                    </>
                  )}
                </Card.Section>
              </Collapse>
            </Card>
          );
        })}
      </Stack>

      <Modal opened={!!editingGuide} onClose={() => setEditingGuide(null)} title="Edit Safety Guide URL" centered>
        <TextInput type="url" placeholder="https://..." value={editingGuide?.value ?? ''} onChange={e => editingGuide && setEditingGuide({ ...editingGuide, value: e.currentTarget.value })} mb="md" />
        <Group grow>
          <Button variant="default" onClick={() => setEditingGuide(null)}>Cancel</Button>
          <Button color="green" onClick={saveGuide} disabled={savingGuide} loading={savingGuide}>Save</Button>
        </Group>
      </Modal>
    </div>
  );
}

// ---- By Person tab ----

function PersonTab({ members, tools, isCertifier, isAdmin }: { members: Member[]; tools: Tool[]; isCertifier: boolean; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [search, setSearch] = useState("");
  const [grantMsg, setGrantMsg] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);

  const toggle = async (memberId: number) => {
    if (expanded === memberId) { setExpanded(null); setCerts([]); return; }
    setExpanded(memberId);
    setLoadingCerts(true);
    try {
      const res = await fetch(`/api/shop/certifications?participantId=${memberId}`);
      if (res.ok) setCerts(await res.json());
    } finally {
      setLoadingCerts(false);
    }
  };

  const filtered = members.filter(m =>
    (m.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <TextInput placeholder="Search members..." value={search} onChange={e => setSearch(e.currentTarget.value)} mb="md" />

      {filtered.length === 0 && <Text c="dimmed">No members match.</Text>}

      <Stack gap="xs">
        {filtered.map((member) => {
          const isOpen = expanded === member.id;
          return (
            <Card key={member.id} withBorder radius="md" padding={0} style={isOpen ? { borderColor: 'var(--mantine-color-cyan-5)' } : undefined}>
              <Group gap="md" p="md" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => toggle(member.id)}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <Text fw={600} c={isOpen ? 'cyan' : undefined} truncate>{member.name ?? 'Unnamed'}</Text>
                  <Text size="sm" c="dimmed" truncate>{member.email}</Text>
                </div>
                <Text c="dimmed" size="sm">{isOpen ? '▲' : '▼'}</Text>
              </Group>

              <Collapse in={isOpen}>
                <Card.Section withBorder p="md">
                  {loadingCerts ? <Center py="sm"><Loader size="sm" /></Center> : (
                    <>
                      <Text fw={600} size="sm" c="dimmed" mb="sm">Tool certifications</Text>
                      {certs.length === 0 ? (
                        <Text c="dimmed" size="sm">No certifications.</Text>
                      ) : (
                        <Stack gap={6} mb="md">
                          {certs.map((c) => (
                            <Group key={`${c.userId}-${c.toolId}`} justify="space-between" p="xs" style={{ borderRadius: 6, background: 'var(--mantine-color-default-hover)' }}>
                              <Text size="sm">{c.tool?.name ?? 'Unknown Tool'}</Text>
                              <ToolLevelBadge level={toToolLevel(c.level)} />
                            </Group>
                          ))}
                        </Stack>
                      )}
                      {isCertifier && (
                        <>
                          {grantMsg && <Text size="sm" c="cyan" mb="sm">{grantMsg}</Text>}
                          <GrantForm tools={tools} members={members} prefillMemberId={member.id}
                            canGrantCertifier={isAdmin}
                            onGranted={m => { setGrantMsg(m); toggle(member.id).then(() => toggle(member.id)); }}
                            saving={grantSaving} setSaving={setGrantSaving} />
                        </>
                      )}
                    </>
                  )}
                </Card.Section>
              </Collapse>
            </Card>
          );
        })}
      </Stack>
    </div>
  );
}

// ---- All Assignments tab ----

function AllTab() {
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch('/api/shop/certifications?all=true')
      .then(r => r.ok ? r.json() : [])
      .then(setCerts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Center py="md"><Loader /></Center>;

  const filtered = certs.filter(c =>
    (c.tool?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.user?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.user?.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <Group justify="space-between" align="center" mb="md" wrap="wrap">
        <TextInput placeholder="Filter by tool or member..." value={search} onChange={e => setSearch(e.currentTarget.value)} style={{ flex: '1 1 220px' }} />
        <Text size="sm" c="dimmed">{filtered.length} assignment{filtered.length !== 1 ? 's' : ''}</Text>
      </Group>

      {filtered.length === 0 ? (
        <Text c="dimmed">No assignments found.</Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tool</Table.Th>
                <Table.Th>Member</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th ta="center">Level</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((c) => (
                <Table.Tr key={`${c.userId}-${c.toolId}`}>
                  <Table.Td fw={500}>{c.tool?.name ?? '?'}</Table.Td>
                  <Table.Td>{c.user?.name ?? 'Unnamed'}</Table.Td>
                  <Table.Td c="dimmed">{c.user?.email}</Table.Td>
                  <Table.Td ta="center"><ToolLevelBadge level={toToolLevel(c.level)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </div>
  );
}

// ---- Main page ----

export default function ToolManagementPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasFetched = useRef(false);

  const [tab, setTab] = useState<Tab>('tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push('/');
    else if (status === "authenticated" && !hasFetched.current) {
      hasFetched.current = true;
      Promise.all([
        fetch('/api/shop/tools').then(r => r.ok ? r.json() : []),
        fetch('/api/shop/members').then(r => r.ok ? r.json() : { members: [] }),
      ]).then(([toolData, memberData]) => {
        setTools(toolData);
        setMembers(memberData.members ?? []);
      }).finally(() => setLoading(false));
    }
  }, [status, router]);

  if (loading || status === "loading") {
    return <Center mih="60vh"><Loader /></Center>;
  }

  const isSysadmin = session?.user?.sysadmin;
  const isBoardMember = session?.user?.boardMember;
  const isAdmin = isSysadmin || isBoardMember;

  const hasCertifierAuth = (session?.user?.toolStatuses ?? []).some((ts: { level?: string }) => ts.level === 'MAY_CERTIFY_OTHERS');
  const isCertifier = isSysadmin || isBoardMember || hasCertifierAuth;

  if (!isCertifier && !isAdmin) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">Forbidden: You require the Admin, Board Member, or Certifier role.</Alert>
          <Button onClick={() => router.push('/shop')}>Back to Shop Ops</Button>
        </Card>
      </Container>
    );
  }

  const reloadTools = () => {
    fetch('/api/shop/tools').then(r => r.ok ? r.json() : []).then(setTools);
  };

  return (
    <Container size="lg" py="md">
      <Group justify="space-between" align="center" wrap="wrap" mb="lg">
        <Title order={1}>Tools &amp; Certifications</Title>
        <Button component={Link} href="/shop" variant="default">← Shop Dashboard</Button>
      </Group>

      <Tabs value={tab} onChange={(v) => setTab(v as Tab)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="tools">All Tools</Tabs.Tab>
          <Tabs.Tab value="person">By Person</Tabs.Tab>
          {isAdmin && <Tabs.Tab value="all">All Assignments</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="tools">
          <ToolsTab tools={tools} members={members} isAdmin={!!isAdmin} isCertifier={!!isCertifier} onToolsChange={reloadTools} />
        </Tabs.Panel>
        <Tabs.Panel value="person">
          <PersonTab members={members} tools={tools} isCertifier={!!isCertifier} isAdmin={!!isAdmin} />
        </Tabs.Panel>
        {isAdmin && (
          <Tabs.Panel value="all">
            <AllTab />
          </Tabs.Panel>
        )}
      </Tabs>
    </Container>
  );
}
