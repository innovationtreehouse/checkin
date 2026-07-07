"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Checkbox, Group, NativeSelect, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { PageLoader } from "@/components/ui/PageLoader";
import { formatDateTime } from "@/lib/time";

type PrintedEntry = {
  personId: number;
  name: string | null;
  email: string | null;
  lastPrintedAt: string;
  printedBy: string | null;
  count: number;
};
type GapEntry = { personId: number; name: string | null; email: string | null };
type Report = { year: number; printed: PrintedEntry[]; gaps: GapEntry[] };

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => String(CURRENT_YEAR - i));

const PRINTED_COLUMNS: DataTableColumn<PrintedEntry>[] = [
  { header: "Name", render: (r) => r.name || "Unknown", sortBy: (r) => r.name },
  { header: "Email", render: (r) => r.email, sortBy: (r) => r.email },
  { header: "Last printed", render: (r) => formatDateTime(r.lastPrintedAt), sortBy: (r) => r.lastPrintedAt },
  { header: "Recorded by", render: (r) => r.printedBy || "—", sortBy: (r) => r.printedBy },
  { header: "Prints", align: "right", render: (r) => r.count, sortBy: (r) => r.count },
];

export default function BadgePrintsPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/facility/badge-prints?year=${year}`);
      if (res.ok) {
        setReport(await res.json());
      } else {
        notifications.show({ color: "red", message: "Failed to load the badge-print report.", autoClose: false });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error loading the report.", autoClose: false });
    } finally {
      setSelectedIds(new Set());
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const gaps = report?.gaps ?? [];

  const toggle = (id: number) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds((cur) => (cur.size === gaps.length ? new Set() : new Set(gaps.map((g) => g.personId))));

  const markPrinted = async (personIds: number[]) => {
    if (personIds.length === 0) return;
    setMarking(true);
    try {
      const res = await fetch("/api/facility/badge-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds }),
      });
      if (res.ok) {
        const { created } = await res.json();
        notifications.show({ color: "green", message: `Marked ${created} badge${created === 1 ? "" : "s"} printed.` });
        await fetchReport();
      } else {
        notifications.show({ color: "red", message: "Failed to mark badges printed.", autoClose: false });
      }
    } catch {
      notifications.show({ color: "red", message: "Network error marking badges printed.", autoClose: false });
    } finally {
      setMarking(false);
    }
  };

  const gapColumns: DataTableColumn<GapEntry>[] = [
    {
      header: (
        <Checkbox
          radius={2}
          checked={gaps.length > 0 && selectedIds.size === gaps.length}
          indeterminate={selectedIds.size > 0 && selectedIds.size < gaps.length}
          onChange={toggleAll}
          aria-label="Select all"
        />
      ),
      render: (g) => (
        <Checkbox
          radius={2}
          checked={selectedIds.has(g.personId)}
          onChange={() => toggle(g.personId)}
          aria-label={`Select ${g.name ?? g.personId}`}
        />
      ),
    },
    { header: "Name", render: (g) => g.name || "Unknown", sortBy: (g) => g.name },
    { header: "Email", render: (g) => g.email, sortBy: (g) => g.email },
    {
      header: "",
      align: "right",
      render: (g) => (
        <Button size="xs" variant="light" disabled={marking} onClick={() => markPrinted([g.personId])}>
          Mark printed
        </Button>
      ),
    },
  ];

  if (loading && !report) return <PageLoader />;

  return (
    <Stack>
      <Group>
        <NativeSelect
          label="Report year"
          data={YEAR_OPTIONS}
          value={String(year)}
          onChange={(e) => setYear(parseInt(e.currentTarget.value, 10))}
          w={140}
        />
      </Group>

      <Title order={4}>Not yet printed in {year} ({gaps.length})</Title>
      <Text c="dimmed" size="sm">
        People who checked in during {year} without a badge print recorded that year.
      </Text>
      <Group>
        <Button
          disabled={selectedIds.size === 0 || marking}
          loading={marking}
          onClick={() => markPrinted([...selectedIds])}
        >
          Mark selected printed ({selectedIds.size})
        </Button>
      </Group>
      <DataTable
        columns={gapColumns}
        rows={gaps}
        getRowKey={(g) => g.personId}
        loading={loading}
        emptyMessage="Everyone who visited this year has a badge printed."
      />

      <Title order={4} mt="lg">Printed in {year} ({report?.printed.length ?? 0})</Title>
      <DataTable
        columns={PRINTED_COLUMNS}
        rows={report?.printed ?? []}
        getRowKey={(r) => r.personId}
        loading={loading}
        emptyMessage="No badges recorded as printed this year."
      />
    </Stack>
  );
}
