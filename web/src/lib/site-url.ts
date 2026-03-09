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
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_VERCEL_URL ??
      process.env.VERCEL_URL ??
      LOCAL_SITE_URL,
  );
}

export function getAuthRedirectUrl(path = "/") {
  if (path === "/") {
    return getSiteUrl();
  }

  return new URL(path, `${getSiteUrl()}/`).toString();
}
