import { act, renderHook, waitFor } from "@testing-library/react";
import { useConflicts, refreshConflicts } from "../useConflicts";
import type { AttendanceConflict } from "@/lib/attendanceConflicts";

const makeConflict = (participantId: number): AttendanceConflict =>
  ({
    participantId,
    participantName: "Kid One",
    eventId: 10,
    eventName: "Robotics",
    visits: [],
  }) as AttendanceConflict;

// Mirrors useTodoCounts's module-level store: one shared snapshot for every
// consumer. These cases intentionally run in order, each building on the
// store state the previous case left behind rather than starting fresh.
describe("useConflicts", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("returns null and fetches nothing while disabled", () => {
    const { result } = renderHook(() => useConflicts(false));
    expect(result.current.conflicts).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches on mount and returns the resolved conflicts", async () => {
    const conflicts = [makeConflict(1)];
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ conflicts }) });

    const { result } = renderHook(() => useConflicts(true));

    await waitFor(() => expect(result.current.conflicts).toEqual(conflicts));
    expect(fetchMock).toHaveBeenCalledWith("/api/my-programs/conflicts");
  });

  it("keeps the last snapshot when a fetch response is not ok", async () => {
    const priorSnapshot = [makeConflict(1)];
    fetchMock.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useConflicts(true));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.conflicts).toEqual(priorSnapshot);
  });

  it("keeps the last snapshot when a fetch rejects", async () => {
    const priorSnapshot = [makeConflict(1)];
    fetchMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useConflicts(true));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.conflicts).toEqual(priorSnapshot);
  });

  it("exposes a refresh() that re-fetches and updates every consumer", async () => {
    const second = [makeConflict(2)];
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ conflicts: second }) });

    const { result } = renderHook(() => useConflicts(true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const third = [makeConflict(3)];
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ conflicts: third }) });

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.conflicts).toEqual(third));
  });

  it("dedupes concurrent refreshConflicts() calls into a single in-flight fetch", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ conflicts: [] }) });
    fetchMock.mockClear();

    refreshConflicts();
    refreshConflicts();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
