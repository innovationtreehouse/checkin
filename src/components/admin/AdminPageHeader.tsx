import Link from "next/link";
import { Button, Group, Title } from "@mantine/core";

export interface AdminPageBackLink {
  href: string;
  label: string;
}

export interface AdminPageHeaderProps {
  /** Page heading, rendered as <Title order={1}>. */
  title: React.ReactNode;
  /** Optional back/cancel link rendered on the right of the header row. */
  back?: AdminPageBackLink;
  /** Optional extra right-aligned actions, shown to the left of the back link. */
  actions?: React.ReactNode;
  /** Bottom margin for the header row (Mantine spacing token or number). */
  mb?: string | number;
}

/**
 * Shared admin page header: a left-aligned title with an optional right-aligned
 * back link (and/or action buttons). Consolidates the
 * `<Group justify="space-between"><Title/><Button>back</Button></Group>` block
 * that was duplicated across the admin pages.
 */
export function AdminPageHeader({ title, back, actions, mb }: AdminPageHeaderProps) {
  return (
    <Group justify="space-between" align="center" wrap="wrap" mb={mb}>
      <Title order={1}>{title}</Title>
      {(actions || back) && (
        <Group gap="xs">
          {actions}
          {back && (
            <Button component={Link} href={back.href} variant="default">
              {back.label}
            </Button>
          )}
        </Group>
      )}
    </Group>
  );
}
