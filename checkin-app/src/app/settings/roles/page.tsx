"use client";

import { useState, useEffect, useCallback } from 'react';
import { Center, Checkbox, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { useRequireRole } from '@/hooks/useRequireRole';
import { SettingsTabs } from '@/components/admin/SettingsTabs';
import { AlertBanner } from '@/components/admin/AlertBanner';

import { PageLoader } from "@/components/ui/PageLoader";
type UserRole = {
  id: number;
  name: string | null;
  email: string;
  isSysadmin: boolean;
  isBoardMember: boolean;
  isKeyholder: boolean;
  isBackgroundCheckReviewer: boolean;
  isYouth: boolean;
};

const ROLE_COLUMNS: { field: keyof UserRole; label: string }[] = [
  { field: 'isSysadmin', label: 'Sysadmin' },
  { field: 'isBoardMember', label: 'Board Member' },
  { field: 'isKeyholder', label: 'Keyholder' },
  { field: 'isBackgroundCheckReviewer', label: 'BG Reviewer' },
];

export default function RoleAssignmentPage() {
  const { user, ready, loading: authLoading } = useRequireRole(['isSysadmin', 'isBoardMember']);

  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [userSearchText, setUserSearchText] = useState("");
  const [hideYouth, setHideYouth] = useState(true);

  const currentUserIsSysadmin = !!user?.isSysadmin;

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/roles');
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
      const res = await fetch('/api/roles', {
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
    return <PageLoader />;
  }

  if (!ready) return null;

  const filteredUsers = users.filter(u =>
    (!hideYouth || !u.isYouth) &&
    ((u.name || "").toLowerCase().includes((userSearchText || "").toLowerCase()) ||
     (u.email || "").toLowerCase().includes((userSearchText || "").toLowerCase()))
  );

  return (
    <Stack>
      <SettingsTabs active="roles" />

      <Text c="dimmed">
        Manage administrative privileges and access levels for community members. Checkboxes save
        automatically.
      </Text>

      <AlertBanner message={message} tone="error" />

      <Group justify="space-between">
        <TextInput
          placeholder="Search users by name or email..."
          value={userSearchText}
          onChange={(e) => setUserSearchText(e.currentTarget.value)}
          maw={400}
          style={{ flex: 1 }}
        />
        <Checkbox
          label="Hide Youth"
          checked={hideYouth}
          onChange={(e) => setHideYouth(e.currentTarget.checked)}
        />
      </Group>

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
                        disabled={savingId === user.id || (col.field === 'isSysadmin' && !currentUserIsSysadmin)}
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
