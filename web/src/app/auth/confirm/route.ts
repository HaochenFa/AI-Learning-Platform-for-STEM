import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const INVALID_CONFIRMATION_MESSAGE = "Invalid or expired link. Request a new email and try again.";
const INVALID_RECOVERY_MESSAGE =
  "Your password reset link is invalid or has expired. Request a new reset email.";

function isSafeRelativePath(path: string | null): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

function buildRedirectUrl(request: NextRequest, pathname: string) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = pathname;
  redirectUrl.search = "";
  return redirectUrl;
}

function getSuccessRedirectPath(type: EmailOtpType | null, next: string | null): string {
  if (isSafeRelativePath(next)) {
    return next;
  }

  if (type === "recovery") {
    return "/reset-password";
  }

  return "/login";
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const next = request.nextUrl.searchParams.get("next");

  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      const successUrl = buildRedirectUrl(request, getSuccessRedirectPath(type, next));

      if (type === "recovery") {
        successUrl.searchParams.set("recovery", "1");
      } else {
        successUrl.searchParams.set("confirmed", "1");
      }

      return NextResponse.redirect(successUrl);
    }
  }

  if (type === "recovery") {
    const recoveryUrl = buildRedirectUrl(request, "/forgot-password");
    recoveryUrl.searchParams.set("error", INVALID_RECOVERY_MESSAGE);
    return NextResponse.redirect(recoveryUrl);
  }

  const loginUrl = buildRedirectUrl(request, "/login");
  loginUrl.searchParams.set("error", INVALID_CONFIRMATION_MESSAGE);
  return NextResponse.redirect(loginUrl);
}
