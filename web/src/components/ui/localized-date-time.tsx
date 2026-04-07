"use client";

import { useEffect, useState } from "react";
import {
  formatDateOnly,
  formatDateOnlyInTimeZone,
  formatDateTime,
  formatDateTimeInTimeZone,
  formatTimeOnly,
  formatTimeOnlyInTimeZone,
} from "@/lib/format/date";

type LocalizedDateTimeTextProps = {
  value: string | Date | null | undefined;
  prefix?: string;
  emptyLabel?: string;
  kind?: "datetime" | "date" | "time";
  options?: Intl.DateTimeFormatOptions;
  className?: string;
};

const HYDRATION_SAFE_TIME_ZONE = "UTC";

function formatForKind(
  kind: NonNullable<LocalizedDateTimeTextProps["kind"]>,
  value: LocalizedDateTimeTextProps["value"],
  options: Intl.DateTimeFormatOptions,
) {
  if (kind === "date") {
    return formatDateOnly(value, options);
  }
  if (kind === "time") {
    return formatTimeOnly(value, options);
  }
  return formatDateTime(value, options);
}

function formatHydrationSafeForKind(
  kind: NonNullable<LocalizedDateTimeTextProps["kind"]>,
  value: LocalizedDateTimeTextProps["value"],
  options: Intl.DateTimeFormatOptions,
) {
  if (kind === "date") {
    return formatDateOnlyInTimeZone(value, HYDRATION_SAFE_TIME_ZONE, options);
  }
  if (kind === "time") {
    return formatTimeOnlyInTimeZone(value, HYDRATION_SAFE_TIME_ZONE, options);
  }
  return formatDateTimeInTimeZone(value, HYDRATION_SAFE_TIME_ZONE, options);
}

export function LocalizedDateTimeText({
  value,
  prefix = "",
  emptyLabel = "",
  kind = "datetime",
  options = {},
  className,
}: LocalizedDateTimeTextProps) {
  const [label, setLabel] = useState(() =>
    formatHydrationSafeForKind(kind, value, options) || emptyLabel,
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextLabel = formatForKind(kind, value, options) || emptyLabel;
      setLabel(nextLabel);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [emptyLabel, kind, options, value]);

  if (!label) {
    return null;
  }

  return (
    <span suppressHydrationWarning className={className}>
      {prefix}
      {label}
    </span>
  );
}
