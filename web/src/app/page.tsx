import Link from "next/link";
import AmbientBackground from "@/app/components/AmbientBackground";
import BrandMark from "@/app/components/BrandMark";
import HeroContent from "@/app/components/HeroContent";
import AuthSurface from "@/components/auth/AuthSurface";
import HomeAuthDialog from "@/components/auth/HomeAuthDialog";
import { getAuthContext } from "@/lib/auth/session";
import { isGuestModeEnabled } from "@/lib/guest/config";
import { getGuestLandingFeedback } from "@/lib/guest/errors";
import {
  getAuthHref,
  parseAuthMode,
  type AuthSearchParams,
} from "@/lib/auth/ui";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<AuthSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { user, profile, isEmailVerified } = await getAuthContext();
  const accountType = profile?.account_type;
  const isAuthed = Boolean(
    user && isEmailVerified && (accountType === "teacher" || accountType === "student"),
  );
  const guestFeedback = getGuestLandingFeedback({
    error: typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null,
    guest: typeof resolvedSearchParams?.guest === "string" ? resolvedSearchParams.guest : null,
  });
  const authMode = !isAuthed
    ? parseAuthMode(typeof resolvedSearchParams?.auth === "string" ? resolvedSearchParams.auth : null)
    : null;

  const dashboardHref =
    accountType === "teacher"
      ? "/teacher/dashboard"
      : accountType === "student"
        ? "/student/dashboard"
        : "/dashboard";

  const primaryHref = !isAuthed
    ? getAuthHref("sign-up", "modal")
    : accountType === "teacher"
      ? "/classes/new"
      : "/join";
  const primaryLabel = !isAuthed
    ? "Create account"
    : accountType === "teacher"
      ? "Create a class"
      : "Join a class";
  const secondaryHref = isAuthed ? dashboardHref : getAuthHref("sign-in", "modal");
  const secondaryLabel = isAuthed ? "Go to dashboard" : "Sign in";
  const guestHref = !isAuthed && isGuestModeEnabled() ? "/guest/enter" : undefined;
  const guestLabel = guestHref ? "Continue as guest" : undefined;

  return (
    <div className="surface-page relative min-h-screen overflow-hidden">
      <AmbientBackground />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-6 pb-16 pt-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ui-subtle">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-white">
              <BrandMark className="h-4 w-4" />
            </span>
            Learning Platform
          </div>
          <Link
            className="ui-motion-color text-sm text-ui-muted hover:text-accent"
            href={secondaryHref}
            scroll={isAuthed}
          >
            {secondaryLabel} →
          </Link>
        </header>

        <main className="home-hero-frame hero-shell rounded-[2rem] border border-default px-8 pb-12 pt-10 shadow-sm sm:px-12">
          <HeroContent
            primaryHref={primaryHref}
            primaryLabel={primaryLabel}
            secondaryHref={secondaryHref}
            secondaryLabel={secondaryLabel}
            guestHref={guestHref}
            guestLabel={guestLabel}
            guestFeedback={guestFeedback}
          />
        </main>
      </div>

      {!isAuthed ? (
        <HomeAuthDialog mode={authMode}>
          {authMode ? (
            <AuthSurface
              mode={authMode}
              presentation="modal"
              searchParams={resolvedSearchParams}
            />
          ) : null}
        </HomeAuthDialog>
      ) : null}
    </div>
  );
}
