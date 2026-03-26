import Link from "next/link";
import { signOut } from "@/app/actions";
import BrandMark from "@/app/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AppIcons } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AccountType } from "@/lib/auth/session";

export type HeaderBreadcrumb = {
  label: string;
  href?: string;
};

export type NavKey = "dashboard" | "new-class" | "join-class";

export type AuthHeaderProps = {
  breadcrumbs?: HeaderBreadcrumb[];
  activeNav?: NavKey;
  accountType?: AccountType;
  isGuest?: boolean;
  guestRole?: AccountType | null;
  tone?: "default" | "subtle";
  classContext?: {
    classId: string;
    isTeacher: boolean;
    preserveStudentPreview?: boolean;
  };
};

function getNavVariant(isActive: boolean) {
  return isActive ? "default" : "outline";
}

function renderBreadcrumbs(breadcrumbs: HeaderBreadcrumb[], clickable = true) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          const key = `${crumb.label}-${index}`;

          if (clickable && crumb.href && !isLast) {
            return [
              <BreadcrumbItem key={`${key}-item`}>
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>,
              <BreadcrumbSeparator key={`${key}-separator`} />,
            ];
          }
          return (
            <BreadcrumbItem key={key}>
              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default function AuthHeader({
  breadcrumbs,
  activeNav,
  accountType,
  isGuest = false,
  guestRole = null,
  classContext,
  tone = "default",
}: AuthHeaderProps) {
  const resolvedAccountType =
    guestRole ??
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
  const classesHref =
    resolvedAccountType === "teacher"
      ? "/teacher/classes"
      : resolvedAccountType === "student"
        ? "/student/classes"
        : "/dashboard";

  const showTeacherNav = resolvedAccountType === "teacher" || classContext?.isTeacher;
  const classTitle =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1]?.label ?? "Class"
      : "Class";

  const shellClass =
    tone === "subtle"
      ? "sticky top-0 z-40 border-b border-default bg-[var(--surface-muted)]/95 backdrop-blur"
      : "sticky top-0 z-40 border-b border-default bg-[var(--surface-page)]/95 backdrop-blur";

  if (classContext) {
    const openAiChatHref = classContext.preserveStudentPreview
      ? `/classes/${classContext.classId}?as=student&view=chat`
      : `/classes/${classContext.classId}?view=chat`;

    return (
      <div className="sticky top-0 z-40 border-b border-default bg-[var(--surface-page)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="editorial-title truncate text-2xl text-ui-primary">{classTitle}</h1>
            {isGuest ? (
              <Badge variant="secondary" className="capitalize">
                Guest {resolvedAccountType}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isGuest ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={classesHref}>My Classes</Link>
              </Button>
            )}
            {classContext.isTeacher ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/classes/${classContext.classId}#teacher-chat-monitor`}>Chat Monitor</Link>
                </Button>
                <Button asChild variant="warm" size="sm">
                  <Link href={`/classes/${classContext.classId}/activities/quiz/new`}>New Quiz</Link>
                </Button>
              </>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={openAiChatHref}>Open AI Chat</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link
          href={dashboardHref}
          className="ui-motion-color flex items-center gap-2 text-sm font-semibold tracking-wide text-ui-subtle hover:text-accent"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-white">
            <BrandMark className="h-4 w-4" />
          </span>
          Learning Platform
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button asChild variant={getNavVariant(activeNav === "dashboard")} size="sm">
            <Link href={dashboardHref} aria-current={activeNav === "dashboard" ? "page" : undefined}>
              Dashboard
            </Link>
          </Button>
          {showTeacherNav ? (
            <Button asChild variant={getNavVariant(activeNav === "new-class")} size="sm">
              <Link href="/classes/new" aria-current={activeNav === "new-class" ? "page" : undefined}>
                New Class
              </Link>
            </Button>
          ) : (
            <Button asChild variant={getNavVariant(activeNav === "join-class")} size="sm">
              <Link href="/join" aria-current={activeNav === "join-class" ? "page" : undefined}>
                Join Class
              </Link>
            </Button>
          )}
          {isGuest ? (
            <Button asChild variant="warm" size="sm">
              <Link href="/register">Create account</Link>
            </Button>
          ) : (
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="hover:bg-[rgba(244,63,94,0.08)] hover:text-[var(--status-error-fg,#9f1239)]">
                <AppIcons.logout className="h-4 w-4" />
                Sign Out
              </Button>
            </form>
          )}
        </div>
      </div>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className={cn("mx-auto w-full max-w-6xl px-6 pb-5", tone === "subtle" ? "pb-4" : "pb-5")}>
          <div className="flex items-center gap-3">
            {renderBreadcrumbs(breadcrumbs)}
            {resolvedAccountType ? (
              <Badge variant="secondary" className="capitalize">
                {isGuest ? `Guest ${resolvedAccountType}` : resolvedAccountType}
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
