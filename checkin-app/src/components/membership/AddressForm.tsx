"use client";

import { SimpleGrid, Stack, TextInput } from "@mantine/core";
import type { StructuredAddress } from "@/lib/address";

export default function AddressForm({
  address,
  onChange,
  error,
  onErrorClear,
}: {
  address: StructuredAddress;
  onChange: (address: StructuredAddress) => void;
  error?: string;
  onErrorClear: () => void;
}) {
  return (
    <Stack gap="xs">
      <TextInput
        label="Street address"
        value={address.line1 ?? ""}
        error={error}
        onChange={(e) => { onChange({ ...address, line1: e.currentTarget.value }); onErrorClear(); }}
        placeholder="123 Main St"
      />
      <TextInput label="Apt / Suite (optional)" value={address.line2 ?? ""} onChange={(e) => onChange({ ...address, line2: e.currentTarget.value })} placeholder="Apt 4B" />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="City" value={address.city ?? ""} onChange={(e) => onChange({ ...address, city: e.currentTarget.value })} />
        <TextInput label="State" maxLength={2} value={address.state ?? ""} onChange={(e) => onChange({ ...address, state: e.currentTarget.value })} placeholder="TX" />
        <TextInput label="ZIP" value={address.postalCode ?? ""} onChange={(e) => onChange({ ...address, postalCode: e.currentTarget.value })} placeholder="78701" />
      </SimpleGrid>
    </Stack>
  );
}
