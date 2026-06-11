import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { DataTable, type DataTableColumn, type DataTableProps } from "../DataTable";

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
  // Mantine's Table.ScrollContainer (ScrollArea) needs ResizeObserver, absent in jsdom.
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
});

type Row = { id: number; name: string };
const columns: DataTableColumn<Row>[] = [
  { header: "ID", render: (r) => r.id },
  { header: "Name", render: (r) => r.name },
];

const renderTable = (props: Partial<DataTableProps<Row>>) =>
  render(
    <MantineProvider>
      <DataTable<Row> columns={columns} rows={[]} getRowKey={(r) => r.id} {...props} />
    </MantineProvider>,
  );

describe("DataTable", () => {
  it("renders headers and one cell per column per row", () => {
    renderTable({ rows: [{ id: 1, name: "Ada" }, { id: 2, name: "Linus" }] });
    expect(screen.getByText("ID")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Linus")).toBeTruthy();
  });

  it("shows the empty message when there are no rows", () => {
    renderTable({ rows: [], emptyMessage: "Nothing here." });
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });

  it("shows a loader (and no empty message) while loading", () => {
    const { container } = renderTable({ rows: [], loading: true, emptyMessage: "Nothing here." });
    expect(screen.queryByText("Nothing here.")).toBeNull();
    expect(container.querySelector(".mantine-Loader-root")).not.toBeNull();
  });

  it("applies per-row props", () => {
    const { container } = renderTable({
      rows: [{ id: 1, name: "Ada" }],
      rowProps: () => ({ className: "selected-row" }),
    });
    expect(container.querySelector("tr.selected-row")).not.toBeNull();
  });
});
