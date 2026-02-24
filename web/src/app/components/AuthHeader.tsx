import Link from "next/link";
import { signOut } from "@/app/actions";
import BrandMark from "@/app/components/BrandMark";
import type { AccountType } from "@/lib/auth/session";

type Breadcrumb = {
  label: string;
  href?: string;
};

type NavKey = "dashboard" | "new-class" | "join-class";

type AuthHeaderProps = {
  breadcrumbs?: Breadcrumb[];
  activeNav?: NavKey;
  accountType?: AccountType;
  tone?: "default" | "subtle";
  classContext?: {
    classId: string;
    isTeacher: boolean;
  };
};

function getNavClass(isActive: boolean) {
  const base =
    "ui-motion-color rounded-full border px-4 py-2 text-xs font-semibold tracking-wide";
  if (isActive) {
    return `${base} chip-warm`;
  }
  return `${base} chip-neutral hover:border-[#d5cab6] hover:bg-[#f9f4ea] hover:text-[#7d412f]`;
}

export default function AuthHeader({
  breadcrumbs,
  activeNav,
  accountType,
  classContext,
  tone = "default",
}: AuthHeaderProps) {
  const resolvedAccountType =
    accountType ??
    (classContext
      ? classContext.isTeacher
        ? "teacher"
        : "student"
      : null);
  const dashboardHref =
    resolvedAccountType === "teacher"
      ? "/teacher/dashboard"
      : resolvedAccountType === "student"
        ? "/student/dashboard"
        : "/dashboard";
  const showTeacherNav = resolvedAccountType === "teacher" || classContext?.isTeacher;
  const shellClass =
    tone === "subtle"
      ? "sticky top-0 z-40 border-b border-[#e7e0d2] bg-[#f7f3ea]/95 backdrop-blur"
      : "sticky top-0 z-40 border-b border-[#e7e0d2] bg-[#fffdf8]/95 backdrop-blur";

  return (
    <div className={shellClass}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link
          href={dashboardHref}
          className="ui-motion-color flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-700 hover:text-[#7d412f]"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1d1d1b] text-[#f8f2ea]">
            <BrandMark className="h-4 w-4" />
          </span>
          Learning Platform
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={dashboardHref}
            className={getNavClass(activeNav === "dashboard")}
            aria-current={activeNav === "dashboard" ? "page" : undefined}
          >
            Dashboard
          </Link>
          {showTeacherNav ? (
            <Link
              href="/classes/new"
              className={getNavClass(activeNav === "new-class")}
              aria-current={activeNav === "new-class" ? "page" : undefined}
            >
              New Class
            </Link>
          ) : (
            <Link
              href="/join"
              className={getNavClass(activeNav === "join-class")}
              aria-current={activeNav === "join-class" ? "page" : undefined}
            >
              Join Class
            </Link>
          )}
          {classContext ? (
            <>
              <Link
                href={
                  classContext.isTeacher
                    ? `/classes/${classContext.classId}#teacher-chat-monitor`
                    : `/classes/${classContext.classId}?view=chat`
                }
                className="ui-motion-color rounded-full border border-[#ddd4c4] bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[#d2b08f] hover:text-[#874935]"
              >
                {classContext.isTeacher ? "Chat Monitor" : "Open AI Chat"}
              </Link>
              {classContext.isTeacher ? (
                <Link
                  href={`/classes/${classContext.classId}/activities/chat/new`}
                  className="ui-motion-color chip-warm rounded-full px-4 py-2 text-xs font-semibold hover:bg-[#fae7df]"
                >
                  New Chat Assignment
                </Link>
              ) : null}
            </>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              className="ui-motion-color rounded-full border border-[#ddd4c4] bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-6 pb-5">
          <nav className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              if (crumb.href && !isLast) {
                return (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                    <Link href={crumb.href} className="ui-motion-color hover:text-[#81412d]">
                      {crumb.label}
                    </Link>
                    <span className="text-slate-300">/</span>
                  </span>
                );
              }
              return (
                <span key={`${crumb.label}-${index}`} className="text-slate-700">
                  {crumb.label}
                </span>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
