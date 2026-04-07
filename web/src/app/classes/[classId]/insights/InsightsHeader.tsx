"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { getClassInsights } from "@/lib/actions/insights";
import {
  formatDateTimeInTimeZone,
  formatRelativeTimeFromNow,
} from "@/lib/format/date";

/** Props for the insights page header. */
type InsightsHeaderProps = {
  classId: string;
  generatedAt: string;
};

/**
 * Insights page header with snapshot timestamp and manual refresh button.
 *
 * Displays when the last analytics snapshot was generated using a human-
 * friendly relative time string (e.g. "5m ago", "2h ago").
 *
 * **Refresh flow:** Clicking "Refresh" calls `getClassInsights(classId, true)`
 * with `forceRefresh=true` to bypass the cache and trigger a fresh snapshot
 * computation on the backend. On success, `router.refresh()` re-fetches the
 * Server Component tree without a full navigation.
 */
export default function InsightsHeader({ classId, generatedAt }: InsightsHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const absoluteTimestampLabel = useMemo(
    () =>
      formatDateTimeInTimeZone(generatedAt, "UTC", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [generatedAt],
  );
  const [relativeTimestampLabel, setRelativeTimestampLabel] = useState<{
    generatedAt: string;
    label: string;
  } | null>(null);
  const timestampLabel =
    relativeTimestampLabel?.generatedAt === generatedAt
      ? relativeTimestampLabel.label
      : absoluteTimestampLabel;

  useEffect(() => {
    const updateRelativeLabel = () => {
      const nextLabel = formatRelativeTimeFromNow(generatedAt);
      if (!nextLabel) {
        return;
      }

      setRelativeTimestampLabel({
        generatedAt,
        label: nextLabel,
      });
    };

    const timeoutId = window.setTimeout(updateRelativeLabel, 0);
    const intervalId = window.setInterval(updateRelativeLabel, 60_000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [generatedAt]);

  const handleRefresh = () => {
    setError(null);
    startTransition(async () => {
      const result = await getClassInsights(classId, true);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Teacher Studio</p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">Class Intelligence</h1>
          <p className="mt-1.5 text-sm text-ui-muted">
            Last updated {timestampLabel}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isPending}
          className="mt-1 flex items-center gap-2"
        >
          {isPending ? (
            <AppIcons.loading className="h-4 w-4 animate-spin" />
          ) : (
            <span className="text-base">↻</span>
          )}
          {isPending ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error ? (
        <TransientFeedbackAlert
          variant="error"
          message={`Failed to refresh — ${error}`}
          className="mt-4"
        />
      ) : null}
    </div>
  );
}
