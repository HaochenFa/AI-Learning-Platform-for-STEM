import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { GUEST_SESSION_INACTIVITY_TIMEOUT_MS } from "@/lib/guest/config";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute =
    pathname === "/dashboard" ||
    pathname === "/join" ||
    pathname === "/settings" ||
    pathname === "/help" ||
    pathname.startsWith("/classes") ||
    pathname.startsWith("/teacher") ||
    pathname.startsWith("/student");

  const candidate = user as
    | {
        is_anonymous?: boolean;
        app_metadata?: { provider?: string | null } | null;
      }
    | null;
  const isAnonymous =
    candidate?.is_anonymous === true || candidate?.app_metadata?.provider === "anonymous";

  if (isProtectedRoute && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("error", "Please sign in.");
    return NextResponse.redirect(loginUrl);
  }

  if (isProtectedRoute && isAnonymous) {
    const guestUser = user;
    if (!guestUser) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("error", "Please sign in.");
      return NextResponse.redirect(loginUrl);
    }

    if (!pathname.startsWith("/classes/")) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const { data: sandbox, error: sandboxError } = await supabase
      .from("guest_sandboxes")
      .select("class_id,status,expires_at,last_seen_at")
      .eq("user_id", guestUser.id)
      .eq("status", "active")
      .maybeSingle<{
        class_id: string | null;
        status: "active" | "expired" | "discarded";
        expires_at: string;
        last_seen_at: string;
      }>();

    if (sandboxError) {
      return NextResponse.redirect(new URL("/?error=guest-session-check-failed", request.url));
    }

    const isExpired =
      !sandbox ||
      !sandbox.class_id ||
      new Date(sandbox.expires_at).getTime() <= Date.now() ||
      new Date(sandbox.last_seen_at).getTime() <= Date.now() - GUEST_SESSION_INACTIVITY_TIMEOUT_MS;

    if (isExpired) {
      if (sandbox) {
        await supabase
          .from("guest_sandboxes")
          .update({
            status: "expired",
          })
          .eq("user_id", guestUser.id)
          .eq("status", "active");
      }

      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/?guest=expired", request.url));
    }

    const [, rootSegment, classIdSegment] = pathname.split("/");
    if (rootSegment === "classes" && classIdSegment && classIdSegment !== sandbox.class_id) {
      return NextResponse.redirect(new URL(`/classes/${sandbox.class_id}`, request.url));
    }

    return response;
  }

  if (user && !user.email_confirmed_at && isProtectedRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("error", "Please verify your email before continuing.");
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard",
    "/join",
    "/settings",
    "/help",
    "/classes/:path*",
    "/teacher/:path*",
    "/student/:path*",
  ],
};
