import { Text } from "@mantine/core";

/** Render a trusted adult's phone and/or email as dimmed lines. Null when neither. */
export function TrustedAdultContact({ phone, email }: { phone: string | null; email: string | null }) {
    if (!phone && !email) return null;
    return (
        <>
            {phone && <Text size="xs" c="dimmed" mt={2}>Phone: {phone}</Text>}
            {email && <Text size="xs" c="dimmed" mt={2}>Email: {email}</Text>}
        </>
    );
}
