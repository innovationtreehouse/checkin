"use client";

import { SimpleGrid, TextInput } from "@mantine/core";

export default function EmergencyContactForm({
  emName, setEmName,
  emPhone, setEmPhone,
  emEmail, setEmEmail,
  errors,
  clearErr,
}: {
  emName: string; setEmName: (v: string) => void;
  emPhone: string; setEmPhone: (v: string) => void;
  emEmail: string; setEmEmail: (v: string) => void;
  errors: Record<string, string>;
  clearErr: (key: string) => void;
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
      <TextInput label="Emergency contact name" value={emName} error={errors.emName} onChange={(e) => { setEmName(e.currentTarget.value); clearErr("emName"); }} />
      <TextInput label="Emergency contact phone" value={emPhone} error={errors.emPhone} onChange={(e) => { setEmPhone(e.currentTarget.value); clearErr("emPhone"); }} />
      <TextInput type="email" label="Emergency contact email (optional)" value={emEmail} error={errors.emEmail} onChange={(e) => { setEmEmail(e.currentTarget.value); clearErr("emEmail"); }} />
    </SimpleGrid>
  );
}
