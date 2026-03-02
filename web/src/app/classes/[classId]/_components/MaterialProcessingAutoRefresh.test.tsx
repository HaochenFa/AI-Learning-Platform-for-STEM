import { describe, expect, it, vi } from "vitest";
import { syncMaterialStatus } from "@/app/classes/[classId]/_components/MaterialProcessingAutoRefresh";

describe("syncMaterialStatus", () => {
  it("starts refresh timer when processingCount is greater than zero", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const replace = vi.fn();

    const cleanup = syncMaterialStatus({
      processingCount: 1,
      pollIntervalMs: 5000,
      clearUploadedParam: true,
      pathname: "/classes/class-1",
      searchParams: new URLSearchParams("uploaded=processing"),
      refresh,
      replace,
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });

    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();

    cleanup();
    vi.useRealTimers();
  });

  it("does not start a refresh timer when processingCount is zero", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();

    const cleanup = syncMaterialStatus({
      processingCount: 0,
      pollIntervalMs: 5000,
      clearUploadedParam: false,
      pathname: "/classes/class-1",
      searchParams: new URLSearchParams("uploaded=processing"),
      refresh,
      replace: vi.fn(),
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });

    vi.advanceTimersByTime(15000);
    expect(refresh).not.toHaveBeenCalled();

    cleanup();
    vi.useRealTimers();
  });

  it("stops refreshing after processing transitions to zero", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();

    const activeCleanup = syncMaterialStatus({
      processingCount: 2,
      pollIntervalMs: 5000,
      clearUploadedParam: true,
      pathname: "/classes/class-1",
      searchParams: new URLSearchParams("uploaded=processing"),
      refresh,
      replace: vi.fn(),
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });

    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(1);

    activeCleanup();

    const settledCleanup = syncMaterialStatus({
      processingCount: 0,
      pollIntervalMs: 5000,
      clearUploadedParam: true,
      pathname: "/classes/class-1",
      searchParams: new URLSearchParams("uploaded=processing"),
      refresh,
      replace: vi.fn(),
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });

    vi.advanceTimersByTime(15000);
    expect(refresh).toHaveBeenCalledTimes(1);

    settledCleanup();
    vi.useRealTimers();
  });

  it("removes only uploaded query param when processing is complete", () => {
    const refresh = vi.fn();
    const replace = vi.fn();

    const cleanup = syncMaterialStatus({
      processingCount: 0,
      pollIntervalMs: 5000,
      clearUploadedParam: true,
      pathname: "/classes/class-1",
      searchParams: new URLSearchParams("uploaded=processing&view=chat&foo=1"),
      refresh,
      replace,
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/classes/class-1?view=chat&foo=1");

    cleanup();
  });
});
