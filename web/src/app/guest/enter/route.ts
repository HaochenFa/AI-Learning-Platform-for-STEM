import { NextResponse } from "next/server";
import { startGuestSession } from "@/app/actions";
import {
  GUEST_SESSIONS_PER_HOUR,
  GUEST_SESSION_RATE_LIMIT_WINDOW_MS,
} from "@/lib/guest/config";

const ipSessionMap = new Map<string, number[]>();

function recordableIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function isWithinIpLimit(ip: string) {
  const cutoff = Date.now() - GUEST_SESSION_RATE_LIMIT_WINDOW_MS;
  const recent = (ipSessionMap.get(ip) ?? []).filter((timestamp) => timestamp > cutoff);
  ipSessionMap.set(ip, recent);
  return recent.length < GUEST_SESSIONS_PER_HOUR;
}

function recordGuestSession(ip: string) {
  const timestamps = ipSessionMap.get(ip) ?? [];
  timestamps.push(Date.now());
  ipSessionMap.set(ip, timestamps);
}

export async function GET(request: Request) {
  const ip = recordableIp(request);
  if (!isWithinIpLimit(ip)) {
    return NextResponse.redirect(new URL("/?error=too-many-guest-sessions", request.url));
  }

  const result = await startGuestSession();
  if (!result.ok || !result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }

  recordGuestSession(ip);
  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
