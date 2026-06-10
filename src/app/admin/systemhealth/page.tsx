"use client";

import { useState, useEffect } from "react";
import { Anchor, Badge, Card, Center, Code, Group, List, Loader, Stack, Text, Title } from "@mantine/core";

type DailyStat = {
  date: string;
  count: number;
  median: number;
  p90: number;
  p99: number;
};

// A dependency-free SVG Line Chart Component
function SvgLineChart({ data }: { data: DailyStat[] }) {
  if (data.length === 0) return <Text c="dimmed">No data available.</Text>;

  const width = 800;
  const height = 400;
  const padding = 40;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;

  // Find max value to scale the Y axis
  const maxP99 = Math.max(...data.map(d => d.p99), 100); // minimum scale is 100ms
  const yMax = Math.ceil(maxP99 / 100) * 100 + 50; // Add some headroom

  const getX = (index: number) => padding + (index / (data.length - 1)) * graphWidth;
  const getY = (value: number) => height - padding - (value / yMax) * graphHeight;

  const createPath = (key: 'median' | 'p90' | 'p99') => {
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d[key])}`).join(' ');
  };

  return (
    <Card withBorder radius="md" p="md" style={{ overflowX: 'auto' }}>
      <svg width="100%" height="auto" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: '600px', display: 'block' }}>
        {/* Background Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + graphHeight * ratio;
          const val = Math.round(yMax * (1 - ratio));
          return (
            <g key={ratio}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="var(--mantine-color-default-border)" strokeWidth="1" strokeDasharray="4,4" />
              <text x={padding - 10} y={y + 4} fill="var(--mantine-color-dimmed)" fontSize="12" textAnchor="end">{val}ms</text>
            </g>
          );
        })}

        {/* Data Lines */}
        <path d={createPath('median')} fill="none" stroke="#4ade80" strokeWidth="3" />
        <path d={createPath('p90')} fill="none" stroke="#facc15" strokeWidth="3" style={{ opacity: 0.8 }} />
        <path d={createPath('p99')} fill="none" stroke="#ef4444" strokeWidth="3" style={{ opacity: 0.8 }} />

        {/* Data Points and Tooltips (simulated via titles for simplicity) */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={getX(i)} cy={getY(d.p99)} r="4" fill="#ef4444">
              <title>{d.date} - P99: {d.p99}ms ({d.count} scans)</title>
            </circle>
            <circle cx={getX(i)} cy={getY(d.p90)} r="4" fill="#facc15">
              <title>{d.date} - P90: {d.p90}ms ({d.count} scans)</title>
            </circle>
            <circle cx={getX(i)} cy={getY(d.median)} r="4" fill="#4ade80">
              <title>{d.date} - Median: {d.median}ms ({d.count} scans)</title>
            </circle>

            {/* X-Axis Labels (every 5 days to avoid crowding) */}
            {i % 5 === 0 && (
              <text x={getX(i)} y={height - 15} fill="var(--mantine-color-dimmed)" fontSize="12" textAnchor="middle">
                {d.date.substring(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Group justify="center" gap="xl" mt="md">
        <Group gap="xs"><Badge color="green" circle /> <Text size="sm">Median</Text></Group>
        <Group gap="xs"><Badge color="yellow" circle /> <Text size="sm">P90</Text></Group>
        <Group gap="xs"><Badge color="red" circle /> <Text size="sm">P99</Text></Group>
      </Group>
    </Card>
  );
}

type GithubCommit = {
  sha: string;
  html_url: string;
  commit: { message: string };
};

function SystemVersionBox() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkVersion() {
      try {
        const localRes = await fetch('/api/kiosk/version');
        const localData = await localRes.json();
        const currentSha = localData.version;
        setCurrentVersion(currentSha);

        if (currentSha && !currentSha.startsWith('unknown')) {
          const ghRes = await fetch('https://api.github.com/repos/innovationtreehouse/checkin/commits/main');
          if (!ghRes.ok) throw new Error('Failed to fetch latest version from GitHub');

          const ghData = await ghRes.json();
          const latestSha = ghData.sha;
          setLatestVersion(latestSha);

          if (latestSha && currentSha !== latestSha && !latestSha.startsWith(currentSha)) {
            const compRes = await fetch(`https://api.github.com/repos/innovationtreehouse/checkin/compare/${currentSha}...main`);
            if (compRes.ok) {
              const compData = await compRes.json();
              if (compData.commits) {
                setCommits(compData.commits);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to check version:", err);
        setError("Unable to verify updates");
      } finally {
        setLoading(false);
      }
    }
    checkVersion();
  }, []);

  if (loading) {
    return (
      <Card withBorder radius="md" padding="lg">
        <Title order={4} mb="xs">System Version</Title>
        <Text c="dimmed">Checking for updates...</Text>
      </Card>
    );
  }

  const isMismatch = currentVersion && latestVersion && !latestVersion.startsWith(currentVersion) && currentVersion !== latestVersion;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="sm" mb="xs">
        <Title order={4}>System Version</Title>
        {isMismatch && <Badge color="red" circle title="Update Available" />}
      </Group>

      <Text c="dimmed" mb="md">
        Current launched version: <Code>{currentVersion?.substring(0, 7) || 'Unknown'}</Code>
      </Text>

      {error ? (
        <Text c="yellow">{error}</Text>
      ) : isMismatch ? (
        <Stack>
          <Text c="red" fw={700}>
            Update Available! (Latest: <Code>{latestVersion?.substring(0, 7)}</Code>)
          </Text>

          <Anchor
            href={`https://github.com/innovationtreehouse/checkin/compare/${currentVersion}...main`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Upgrade Now
          </Anchor>

          {commits.length > 0 && (
            <Card withBorder radius="sm" p="md">
              <Title order={5} mb="xs">Summary of changes:</Title>
              <List size="sm" spacing="xs">
                {commits.map((c) => (
                  <List.Item key={c.sha}>
                    <Anchor href={c.html_url} target="_blank" rel="noopener noreferrer">
                      <Code>{c.sha.substring(0, 7)}</Code>
                    </Anchor>
                    {' - '}{c.commit.message.split('\n')[0]}
                  </List.Item>
                ))}
              </List>
            </Card>
          )}
        </Stack>
      ) : (
        <Text c="green" fw={700}>✓ System is up to date</Text>
      )}
    </Card>
  );
}

export default function SystemHealthPage() {
  const [stats, setStats] = useState<DailyStat[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/system-health')
      .then(res => res.json())
      .then(data => {
        if (data && data.days) {
          setStats(data.days);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Stack>
      <div>
        <Title order={1}>System Health</Title>
        <Text c="dimmed">
          Monitor the backend performance and round-trip response times for Kiosk functionality.
        </Text>
      </div>

      <SystemVersionBox />

      <Card withBorder radius="md" padding="lg">
        <Title order={4}>Badge Scan Response Times (Last 30 Days)</Title>
        <Text c="dimmed" size="sm" mb="lg">
          This graph displays the operational latency of the badge scanning system. Lower values
          indicate faster responses.
        </Text>

        {loading ? (
          <Center py="xl"><Loader /></Center>
        ) : stats ? (
          <SvgLineChart data={stats} />
        ) : (
          <Center py="xl"><Text c="red">Failed to load metrics.</Text></Center>
        )}
      </Card>
    </Stack>
  );
}
