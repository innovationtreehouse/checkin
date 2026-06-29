"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { NavLink, Stack, Text, TextInput, Title } from '@mantine/core';
import { PageContainer } from '@/components/ui/PageContainer';
import { IconSearch } from '@tabler/icons-react';
import { PAGES, type RegistryUser } from '@/components/pageRegistry';

export default function IndexPage() {
  const { data: session } = useSession();
  const signedIn = !!session;
  const user = session?.user as RegistryUser | undefined;
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => PAGES.filter((p) => p.visible(user, signedIn)),
    [user, signedIn],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((p) =>
      `${p.label} ${p.section} ${p.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [visible, query]);

  // Preserve registry order within each section heading.
  const grouped = useMemo(() => {
    const out: { section: string; pages: typeof matches }[] = [];
    for (const p of matches) {
      const last = out[out.length - 1];
      if (last && last.section === p.section) last.pages.push(p);
      else out.push({ section: p.section, pages: [p] });
    }
    return out;
  }, [matches]);

  return (
    <PageContainer>
      <Title order={2} mb="md">Index</Title>
      <TextInput
        placeholder="Search pages…"
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        data-autofocus
        autoFocus
        mb="lg"
      />
      {grouped.length === 0 ? (
        <Text c="dimmed">No pages match “{query}”.</Text>
      ) : (
        <Stack gap="lg">
          {grouped.map((group) => (
            <div key={group.section}>
              <Text fw={700} size="sm" c="dimmed" tt="uppercase" mb={4}>
                {group.section}
              </Text>
              {group.pages.map((p) => (
                <NavLink
                  key={p.href}
                  component={Link}
                  href={p.href}
                  label={p.label}
                  description={p.href}
                />
              ))}
            </div>
          ))}
        </Stack>
      )}
    </PageContainer>
  );
}
