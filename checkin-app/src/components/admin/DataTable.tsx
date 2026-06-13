import { Center, Loader, Table, Text } from "@mantine/core";

export interface DataTableColumn<T> {
  /** Column header content. */
  header: React.ReactNode;
  /** Cell renderer for a row. */
  render: (row: T) => React.ReactNode;
  /** Horizontal alignment for the header + cells in this column. */
  align?: "left" | "center" | "right";
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
  return (
    <Table.ScrollContainer minWidth={minWidth}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {columns.map((col, i) => (
              <Table.Th key={i} ta={col.align}>
                {col.header}
              </Table.Th>
            ))}
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
            rows.map((row) => (
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
