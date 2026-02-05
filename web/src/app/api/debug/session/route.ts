import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const supabaseCookies = cookieStore
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .map((cookie) => ({
      name: cookie.name,
      length: cookie.value.length,
    }));

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  type JwtClaims = {
    sub?: string;
    role?: string;
    aud?: string | string[];
    iss?: string;
    exp?: number;
    iat?: number;
  };

  let jwtClaims: JwtClaims | null = null;
  if (session?.access_token) {
    try {
      const [, payload] = session.access_token.split(".");
      if (payload) {
        jwtClaims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtClaims;
      }
    } catch {
      jwtClaims = null;
    }
  }

  return NextResponse.json({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    userError: userError?.message ?? null,
    sessionUserId: session?.user?.id ?? null,
    hasAccessToken: Boolean(session?.access_token),
    sessionError: sessionError?.message ?? null,
    jwtSub: jwtClaims?.sub ?? null,
    jwtRole: jwtClaims?.role ?? null,
    jwtAud: jwtClaims?.aud ?? null,
    jwtIss: jwtClaims?.iss ?? null,
    jwtExp: jwtClaims?.exp ?? null,
    jwtIat: jwtClaims?.iat ?? null,
    cookieNames: supabaseCookies.map((cookie) => cookie.name),
  });
}
