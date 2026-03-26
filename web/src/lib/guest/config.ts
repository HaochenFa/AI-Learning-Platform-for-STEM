export function isGuestModeEnabled() {
  const raw = process.env.NEXT_PUBLIC_GUEST_MODE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
