export type AuthMode = "sign-in" | "sign-up" | "forgot-password";

export type AuthSearchParams = {
  auth?: string;
  account_type?: string;
  confirmed?: string;
  email?: string;
  error?: string;
  guest?: string;
  recovery?: string;
  reset?: string;
  sent?: string;
  verify?: string;
};

export type AuthPresentation = "modal" | "page";

const AUTH_MODE_ROUTES: Record<AuthMode, string> = {
  "sign-in": "/login",
  "sign-up": "/register",
  "forgot-password": "/forgot-password",
};

const HOME_AUTH_PREFIX = "/";

export const AUTH_MODAL_QUERY_KEYS = [
  "auth",
  "account_type",
  "confirmed",
  "email",
  "error",
  "guest",
  "reset",
  "sent",
  "verify",
] as const;

export function parseAuthMode(value?: string | null): AuthMode | null {
  if (value === "sign-in" || value === "sign-up" || value === "forgot-password") {
    return value;
  }

  return null;
}

export function getAuthHref(mode: AuthMode, presentation: AuthPresentation) {
  if (presentation === "modal") {
    return `${HOME_AUTH_PREFIX}?auth=${mode}`;
  }

  return AUTH_MODE_ROUTES[mode];
}

export function sanitizeInternalRedirectPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

export function buildRedirectUrl(
  basePath: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(basePath, "http://localhost");

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      url.searchParams.delete(key);
      return;
    }

    url.searchParams.set(key, value);
  });

  const query = Array.from(url.searchParams.entries())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  return `${url.pathname}${query ? `?${query}` : ""}`;
}
