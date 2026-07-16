"use client";

import { SimpleGrid, Stack, TextInput } from "@mantine/core";
import type { StructuredAddress } from "@/lib/address";

type Field = "line1" | "city" | "state" | "postalCode";

export default function AddressForm({
  address,
  onChange,
  errors,
  onErrorClear,
  required = true,
}: {
  address: StructuredAddress;
  onChange: (address: StructuredAddress) => void;
  errors?: Partial<Record<Field, string>>;
  onErrorClear: (field: Field) => void;
  // Membership intake requires a full address; program register collects it as
  // optional (program-first-time profile) — pass required={false} there so the
  // asterisks don't contradict the "optional" heading.
  required?: boolean;
}) {
  const set = (field: Field, value: string) => {
    onChange({ ...address, [field]: value });
    onErrorClear(field);
  };
  return (
    <Stack gap="xs">
      <TextInput
        label="Street address"
        withAsterisk={required}
        value={address.line1 ?? ""}
        error={errors?.line1}
        onChange={(e) => set("line1", e.currentTarget.value)}
        placeholder="123 Main St"
      />
      <TextInput label="Apt / Suite (optional)" value={address.line2 ?? ""} onChange={(e) => onChange({ ...address, line2: e.currentTarget.value })} placeholder="Apt 4B" />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="City" withAsterisk={required} value={address.city ?? ""} error={errors?.city} onChange={(e) => set("city", e.currentTarget.value)} />
        <TextInput label="State" withAsterisk={required} maxLength={2} value={address.state ?? ""} error={errors?.state} onChange={(e) => set("state", e.currentTarget.value)} placeholder="TX" />
        <TextInput label="ZIP" withAsterisk={required} value={address.postalCode ?? ""} error={errors?.postalCode} onChange={(e) => set("postalCode", e.currentTarget.value)} placeholder="78701" />
      </SimpleGrid>
    </Stack>
  );
}
