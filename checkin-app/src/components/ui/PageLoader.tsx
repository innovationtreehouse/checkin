import { Center, Loader, Stack, Text } from "@mantine/core";

export interface PageLoaderProps {
  minHeight?: string;
  label?: string;
}

export function PageLoader({ minHeight = "60vh", label }: PageLoaderProps) {
  return (
    <Center mih={minHeight}>
      <Stack align="center" gap="xs">
        <Loader />
        {label && <Text c="dimmed" size="sm">{label}</Text>}
      </Stack>
    </Center>
  );
}
