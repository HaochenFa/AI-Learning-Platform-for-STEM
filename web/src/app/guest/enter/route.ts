import { NextResponse } from "next/server";
import { startGuestSession } from "@/app/actions";
import { getGuestEntryIp } from "@/lib/guest/entry-rate-limit";

export async function GET(request: Request) {
  const result = await startGuestSession({
    ipAddress: getGuestEntryIp(request),
  });
  if (!result.ok) {
    const error =
      result.error === "too-many-guest-sessions" ? "too-many-guest-sessions" : "guest-unavailable";
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }
  if (!result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }

  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
