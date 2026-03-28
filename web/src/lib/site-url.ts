const LOCAL_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(url: string) {
  const normalized = url.trim();
  if (!normalized) {
    return LOCAL_SITE_URL;
  }

  const withProtocol =
    normalized.startsWith("http://") || normalized.startsWith("https://")
      ? normalized
      : `https://${normalized}`;

  return withProtocol.endsWith("/") ? withProtocol.slice(0, -1) : withProtocol;
}

export function getSiteUrl() {
  // NEXT_PUBLIC_SITE_URL must be explicitly set in Vercel env vars (production + preview).
  // Never fall through to VERCEL_URL / NEXT_PUBLIC_VERCEL_URL — those are per-deployment
  // auto-generated URLs that break email redirect links and template asset fetches.
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL ?? LOCAL_SITE_URL,
  );
}

export function getAuthRedirectUrl(path = "/") {
  if (path === "/") {
    return getSiteUrl();
  }

  return new URL(path, `${getSiteUrl()}/`).toString();
}
