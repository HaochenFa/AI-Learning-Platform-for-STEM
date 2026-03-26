export const GUEST_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const GUEST_SESSION_INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
export const GUEST_SESSIONS_PER_HOUR = 5;
export const GUEST_SESSION_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function isGuestModeEnabled() {
  const raw = process.env.NEXT_PUBLIC_GUEST_MODE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
