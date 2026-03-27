import { getGuestSessionExpiredMessage } from "@/lib/guest/session-expiry";

export type GuestProvisionFailureCode =
  | "guest-unavailable"
  | "too-many-guest-sessions"
  | "guest-auth-unavailable"
  | "guest-session-conflict"
  | "guest-sandbox-provision-failed"
  | "guest-session-check-failed";

export type GuestEntryErrorQuery =
  | "guest-unavailable"
  | "too-many-guest-sessions"
  | "guest-session-check-failed";

export type GuestLandingFeedback = {
  variant: "error" | "warning";
  title: string;
  message: string;
};

export function toGuestEntryErrorQuery(code: GuestProvisionFailureCode): GuestEntryErrorQuery {
  if (code === "too-many-guest-sessions") {
    return code;
  }

  if (code === "guest-session-check-failed") {
    return code;
  }

  return "guest-unavailable";
}

export function getGuestLandingFeedback(input: {
  error?: string | null;
  guest?: string | null;
}): GuestLandingFeedback | null {
  if (input.guest === "expired") {
    return {
      variant: "warning",
      title: "Guest session expired",
      message: getGuestSessionExpiredMessage(),
    };
  }

  switch (input.error) {
    case "too-many-guest-sessions":
      return {
        variant: "warning",
        title: "Guest mode is busy",
        message:
          "Guest mode has reached the current session limit. Please wait a bit before trying again.",
      };
    case "guest-session-check-failed":
      return {
        variant: "warning",
        title: "Guest session could not be verified",
        message: "We couldn't verify your guest session. Please start a new guest session.",
      };
    case "guest-unavailable":
      return {
        variant: "error",
        title: "Guest mode is temporarily unavailable",
        message:
          "We couldn't open the guest classroom right now. Create an account or try again shortly.",
      };
    default:
      return null;
  }
}
