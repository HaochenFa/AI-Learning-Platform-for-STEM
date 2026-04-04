import { NextResponse } from "next/server";
import { startGuestSession } from "@/app/actions";
import { toGuestEntryErrorQuery } from "@/lib/guest/errors";

async function handleGuestEntry(request: Request) {
  const result = await startGuestSession();
  if (!result.ok) {
    const error = toGuestEntryErrorQuery(result.code ?? "guest-unavailable");
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }
  if (!result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }
  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}

export async function POST(request: Request) {
  return handleGuestEntry(request);
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url));
}
