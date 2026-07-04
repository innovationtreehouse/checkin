"use client";

import { Button, Card, Group, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";

interface ChildForm {
  id?: number;
  name: string;
  email: string;
  dob: string;
  allergies: string;
}

export default function ChildrenListForm({
  items,
  onAdd,
  onUpdate,
  onRemove,
  hideEmail = false,
}: {
  items: ChildForm[];
  onAdd: () => void;
  onUpdate: (i: number, field: keyof ChildForm, value: string) => void;
  onRemove: (i: number) => void;
  // Program-first-time intake collects a child's email later (on the household
  // screen), so it hides the email input here; membership intake keeps it.
  hideEmail?: boolean;
}) {
  return (
    <section>
      <Group justify="space-between" align="center" mb="sm">
        <Title order={2}>Children</Title>
        <Button variant="light" size="xs" fz={15} onClick={onAdd}>+ Add child</Button>
      </Group>
      {items.length === 0 && <Text c="dimmed">No children added yet.</Text>}
      <Stack>
        {items.map((child, i) => (
          <Card key={child.id ?? `new-${i}`} withBorder radius="md" padding="md">
            <Group justify="space-between" align="center" mb="xs">
              <Text fw={600}>Child {i + 1}</Text>
              <Button variant="subtle" color="red" size="compact-sm" onClick={() => onRemove(i)}>Remove</Button>
            </Group>
            <TextInput label="Full name" value={child.name} onChange={(e) => onUpdate(i, "name", e.currentTarget.value)} />
            {hideEmail ? (
              <TextInput type="date" mt="sm" label="Date of birth" value={child.dob} onChange={(e) => onUpdate(i, "dob", e.currentTarget.value)} />
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm">
                <TextInput type="date" label="Date of birth" value={child.dob} onChange={(e) => onUpdate(i, "dob", e.currentTarget.value)} />
                <TextInput type="email" label="Email (optional)" value={child.email} onChange={(e) => onUpdate(i, "email", e.currentTarget.value)} />
              </SimpleGrid>
            )}
            <TextInput mt="sm" label="Allergies (optional)" value={child.allergies} onChange={(e) => onUpdate(i, "allergies", e.currentTarget.value)} />
          </Card>
        ))}
      </Stack>
    </section>
  );
}
