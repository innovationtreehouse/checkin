import { useState } from "react";
import { Center, Group, Loader, Table, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconSelector } from "@tabler/icons-react";

export interface DataTableColumn<T> {
  /** Column header content. */
  header: React.ReactNode;
  /** Cell renderer for a row. */
  render: (row: T) => React.ReactNode;
  /** Horizontal alignment for the header + cells in this column. */
  align?: "left" | "center" | "right";
  /**
   * Makes the column sortable: returns the value to sort this row by. Numbers
   * sort numerically, everything else by localeCompare; null/undefined sort
   * last. Omit to leave the column unsortable (e.g. an actions column).
   */
  sortBy?: (row: T) => string | number | null | undefined;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable React key for a row. */
  getRowKey: (row: T) => React.Key;
  /** Min width before the table scrolls horizontally (Table.ScrollContainer). */
  minWidth?: number;
  /** When true, shows a centered loader row instead of rows. */
  loading?: boolean;
  /** Shown (centered, dimmed) when there are no rows and not loading. */
  emptyMessage?: React.ReactNode;
  /** Extra per-row props (e.g. a selected-row `bg`). */
  rowProps?: (row: T) => Partial<React.ComponentProps<typeof Table.Tr>>;
}

/**
 * Config-driven admin table. Owns the repeated
 * `Table.ScrollContainer > Table > Thead/Tbody` scaffolding, the horizontal
 * scroll, and the loading / empty states; callers supply column definitions and
 * rows. Row actions are just a column whose `render` returns buttons, so any
 * per-action confirm stays in the page (the table doesn't need to know about it).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  minWidth = 700,
  loading = false,
  emptyMessage = "No records found.",
  rowProps,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ index: number; dir: "asc" | "desc" } | null>(null);

  const toggleSort = (index: number) =>
    setSort((cur) =>
      cur?.index === index
        ? cur.dir === "asc"
          ? { index, dir: "desc" }
          : null
        : { index, dir: "asc" },
    );

  const sortBy = sort && columns[sort.index]?.sortBy;
  const sortedRows = sortBy
    ? [...rows].sort((a, b) => {
        const av = sortBy(a);
        const bv = sortBy(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // nulls last
        if (bv == null) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sort!.dir === "asc" ? cmp : -cmp;
      })
    : rows;

  return (
    <Table.ScrollContainer minWidth={minWidth}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {columns.map((col, i) => {
              if (!col.sortBy) {
                return (
                  <Table.Th key={i} ta={col.align}>
                    {col.header}
                  </Table.Th>
                );
              }
              const active = sort?.index === i;
              const Icon = !active
                ? IconSelector
                : sort!.dir === "asc"
                  ? IconChevronUp
                  : IconChevronDown;
              return (
                <Table.Th key={i} ta={col.align}>
                  <UnstyledButton
                    onClick={() => toggleSort(i)}
                    style={{ display: "inline-flex", verticalAlign: "middle" }}
                  >
                    <Group gap={4} wrap="nowrap">
                      {col.header}
                      <Icon size={14} stroke={1.5} />
                    </Group>
                  </UnstyledButton>
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading ? (
            <Table.Tr>
              <Table.Td colSpan={columns.length}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : rows.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={columns.length} ta="center">
                <Text c="dimmed" py="md">
                  {emptyMessage}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            sortedRows.map((row) => (
              <Table.Tr key={getRowKey(row)} {...(rowProps?.(row) ?? {})}>
                {columns.map((col, i) => (
                  <Table.Td key={i} ta={col.align}>
                    {col.render(row)}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
