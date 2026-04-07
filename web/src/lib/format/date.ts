const DEFAULT_LOCALE = "en-US";

type DateValue = string | Date | null | undefined;

function parseDate(value: DateValue) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function withOptionalTimeZone(
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
): Intl.DateTimeFormatOptions {
  if (!timeZone) {
    return options;
  }

  return {
    ...options,
    timeZone,
  };
}

export function formatDateTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleString(DEFAULT_LOCALE, options);
}

export function formatDateTimeInTimeZone(
  value: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleString(
    DEFAULT_LOCALE,
    withOptionalTimeZone(options, timeZone),
  );
}

export function formatDateOnly(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleDateString(DEFAULT_LOCALE, options);
}

export function formatDateOnlyInTimeZone(
  value: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleDateString(
    DEFAULT_LOCALE,
    withOptionalTimeZone(options, timeZone),
  );
}

export function formatTimeOnly(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString(DEFAULT_LOCALE, options);
}

export function formatTimeOnlyInTimeZone(
  value: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString(
    DEFAULT_LOCALE,
    withOptionalTimeZone(options, timeZone),
  );
}

export function formatRelativeTimeFromNow(
  value: DateValue,
  nowMs: number = Date.now(),
) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  const diffMs = Math.max(0, nowMs - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}
