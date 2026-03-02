"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type MaterialProcessingAutoRefreshProps = {
  processingCount: number;
  pollIntervalMs?: number;
  clearUploadedParam?: boolean;
};

type MaterialStatusSyncOptions = {
  processingCount: number;
  pollIntervalMs: number;
  clearUploadedParam: boolean;
  pathname: string;
  searchParams: URLSearchParams;
  refresh: () => void;
  replace: (href: string) => void;
  schedule: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  cancel: (id: ReturnType<typeof setInterval>) => void;
};

export function syncMaterialStatus(options: MaterialStatusSyncOptions) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  if (options.processingCount > 0) {
    intervalId = options.schedule(() => {
      options.refresh();
    }, options.pollIntervalMs);
  } else if (options.clearUploadedParam && options.searchParams.has("uploaded")) {
    const nextParams = new URLSearchParams(options.searchParams.toString());
    nextParams.delete("uploaded");
    const query = nextParams.toString();
    options.replace(query.length > 0 ? `${options.pathname}?${query}` : options.pathname);
  }

  return () => {
    if (intervalId !== null) {
      options.cancel(intervalId);
    }
  };
}

export default function MaterialProcessingAutoRefresh({
  processingCount,
  pollIntervalMs = 5000,
  clearUploadedParam = true,
}: MaterialProcessingAutoRefreshProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsSnapshot = searchParams.toString();

  useEffect(() => {
    return syncMaterialStatus({
      processingCount,
      pollIntervalMs,
      clearUploadedParam,
      pathname,
      searchParams: new URLSearchParams(searchParamsSnapshot),
      refresh: () => router.refresh(),
      replace: (href) => router.replace(href),
      schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
      cancel: (id) => clearInterval(id),
    });
  }, [
    clearUploadedParam,
    pathname,
    pollIntervalMs,
    processingCount,
    router,
    searchParamsSnapshot,
  ]);

  if (processingCount <= 0) {
    return null;
  }

  return (
    <p className="mt-2 text-xs text-ui-muted" aria-live="polite">
      Status auto-updates every 5s while processing.
    </p>
  );
}
