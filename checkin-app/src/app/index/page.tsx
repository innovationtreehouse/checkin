"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { NavLink, Stack, Text, TextInput, Title } from '@mantine/core';
import { PageContainer } from '@/components/ui/PageContainer';
import { IconSearch } from '@tabler/icons-react';
import { PAGES, type RegistryUser } from '@/components/pageRegistry';
import { useTodoCounts } from '@/hooks/useTodoCounts';

export default function IndexPage() {
  const { data: session } = useSession();
  const signedIn = !!session;
  const user = session?.user as RegistryUser | undefined;
  // Computed-role gates (leads ≥1 program) read from the same payload the nav uses.
  const counts = useTodoCounts(signedIn);
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => PAGES.filter((p) => p.visible(user, signedIn, counts)),
    [user, signedIn, counts],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((p) =>
      `${p.label} ${p.section} ${p.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [visible, query]);

  // Group by section (first-seen section order, registry page order within).
  const grouped = useMemo(() => {
    const bySection = new Map<string, typeof matches>();
    for (const p of matches) {
      const pages = bySection.get(p.section);
      if (pages) pages.push(p);
      else bySection.set(p.section, [p]);
    }
    return Array.from(bySection, ([section, pages]) => ({ section, pages }));
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
