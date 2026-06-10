"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Center, Checkbox, Group, Loader, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useRequireRole } from '@/hooks/useRequireRole';

type UserRole = {
  id: number;
  name: string | null;
  email: string;
  sysadmin: boolean;
  boardMember: boolean;
  keyholder: boolean;
  shopSteward: boolean;
  backgroundCheckReviewer: boolean;
};

const ROLE_COLUMNS: { field: keyof UserRole; label: string }[] = [
  { field: 'sysadmin', label: 'Sysadmin' },
  { field: 'boardMember', label: 'Board Member' },
  { field: 'keyholder', label: 'Keyholder' },
  { field: 'shopSteward', label: 'Shop Steward' },
  { field: 'backgroundCheckReviewer', label: 'BG Reviewer' },
];

export default function RoleAssignmentPage() {
  const { user, ready, loading: authLoading } = useRequireRole(['sysadmin', 'boardMember']);
  const router = useRouter();

  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [userSearchText, setUserSearchText] = useState("");

  const currentUserIsSysadmin = !!user?.sysadmin;

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/roles');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.participants);
      } else {
        setMessage("Failed to load user list.");
      }
    } catch {
      setMessage("Network error loading users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) fetchUsers();
  }, [ready, fetchUsers]);

  const handleRoleChange = async (userId: number, field: keyof UserRole, value: boolean) => {
    setSavingId(userId);
    setMessage("");

    // Optimistic update
    setUsers(users.map(u => u.id === userId ? { ...u, [field]: value } : u));

    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          [field]: value
        })
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error || "Failed to update role.");
        // Revert optimistic update
        fetchUsers();
      }
    } catch {
      setMessage("Network error updating role.");
      fetchUsers();
    } finally {
      setSavingId(null);
    }
  };

  if (authLoading || loading) {
    return <Center mih="60vh"><Loader /></Center>;
  }

  if (!ready) return null;

  const filteredUsers = users.filter(u =>
    (u.name || "").toLowerCase().includes((userSearchText || "").toLowerCase()) ||
    (u.email || "").toLowerCase().includes((userSearchText || "").toLowerCase())
  );

  return (
    <Stack>
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1}>Role Assignment</Title>
        <Button variant="default" onClick={() => router.push('/admin')}>← Back to Admin Hub</Button>
      </Group>

      <Text c="dimmed">
        Manage administrative privileges and access levels for community members. Checkboxes save
        automatically.
      </Text>

      {message && <Alert color="red">{message}</Alert>}

      <TextInput
        placeholder="Search users by name or email..."
        value={userSearchText}
        onChange={(e) => setUserSearchText(e.currentTarget.value)}
        maw={400}
      />

      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              {ROLE_COLUMNS.map((col) => (
                <Table.Th key={col.field} ta="center">{col.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredUsers.map((user) => (
              <Table.Tr key={user.id}>
                <Table.Td>
                  <Text fw={500}>{user.name || 'Unnamed'}</Text>
                  <Text size="sm" c="dimmed">{user.email}</Text>
                </Table.Td>
                {ROLE_COLUMNS.map((col) => (
                  <Table.Td key={col.field} ta="center">
                    <Center>
                      <Checkbox
                        checked={user[col.field] as boolean}
                        disabled={savingId === user.id || (col.field === 'sysadmin' && !currentUserIsSysadmin)}
                        onChange={(e) => handleRoleChange(user.id, col.field, e.currentTarget.checked)}
                      />
                    </Center>
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
