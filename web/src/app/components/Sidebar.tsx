"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { signOut } from "@/app/actions";
import BrandMark from "@/app/components/BrandMark";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STANDARD_EASE, STANDARD_TRANSITION } from "@/lib/motion/presets";
import { cn } from "@/lib/utils";
import type { AccountType } from "@/lib/auth/session";

type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof AppIcons;
  match?: (pathname: string) => boolean;
};

const teacherNavItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/teacher/dashboard",
    icon: "dashboard",
  },
  {
    label: "My Classes",
    href: "/teacher/classes",
    icon: "classes",
    match: (pathname) =>
      pathname === "/teacher/classes" || pathname === "/classes/new" || pathname.startsWith("/classes/"),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
  },
  {
    label: "Help",
    href: "/help",
    icon: "help",
  },
];

const studentNavItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/student/dashboard",
    icon: "dashboard",
  },
  {
    label: "My Classes",
    href: "/student/classes",
    icon: "classes",
    match: (pathname) => pathname === "/student/classes" || pathname.startsWith("/classes/"),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
  },
  {
    label: "Help",
    href: "/help",
    icon: "help",
  },
];

type SidebarProps = {
  accountType: AccountType;
  userEmail?: string;
  userDisplayName?: string | null;
  classId?: string;
  isGuest?: boolean;
  guestRole?: AccountType | null;
};

const COLLAPSED_KEY = "ui.sidebar.collapsed";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

export default function Sidebar({
  accountType,
  userEmail,
  userDisplayName,
  classId,
  isGuest = false,
  guestRole = null,
}: SidebarProps) {
  const pathname = usePathname();
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 1024px)").matches;
  });
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  });
  const isCompact = isCollapsed || isMobileViewport;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1024px)");
    const updateViewportState = () => setIsMobileViewport(mediaQuery.matches);
    updateViewportState();
    mediaQuery.addEventListener("change", updateViewportState);
    return () => {
      mediaQuery.removeEventListener("change", updateViewportState);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, isCollapsed ? "true" : "false");
  }, [isCollapsed]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sidebar-width", isCompact ? "5rem" : "16rem");
    return () => {
      root.style.setProperty("--sidebar-width", "16rem");
    };
  }, [isCompact]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setIsCollapsed((value) => !value);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navItems = isGuest
    ? [
        {
          label: "Guest Classroom",
          href: classId ? `/classes/${classId}` : "/",
          icon: "classes" as const,
          match: (currentPathname: string) => currentPathname.startsWith("/classes/"),
        },
      ]
    : accountType === "teacher"
      ? teacherNavItems
      : studentNavItems;
  const displayName = isGuest ? "Guest Explorer" : userDisplayName || userEmail || "User";
  const displayEmail = isGuest ? "Temporary session" : userDisplayName && userEmail ? userEmail : null;
  const roleLabel = isGuest ? `Guest ${guestRole ?? accountType}` : accountType;
  const homeHref = isGuest
    ? classId
      ? `/classes/${classId}`
      : "/"
    : accountType === "teacher"
      ? "/teacher/dashboard"
      : "/student/dashboard";

  const isActive = (item: NavItem) => {
    if (item.match) {
      return item.match(pathname);
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <motion.aside
        className="fixed left-0 top-0 z-50 flex h-screen flex-col overflow-hidden border-r border-default bg-background"
        animate={{ width: isCompact ? "5rem" : "16rem" }}
        transition={{ duration: STANDARD_TRANSITION.duration, ease: STANDARD_EASE }}
      >
      <div className={cn("flex h-16 items-center border-b border-default px-4", isCompact ? "justify-center" : "justify-between")}>
        {!isCompact && (
          <Link
            href={homeHref}
            className="flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-white">
              <BrandMark className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-ui-primary">Learning Platform</span>
          </Link>
        )}
        <Button
          onClick={() => setIsCollapsed((value) => !value)}
          variant="outline"
          size="icon"
          aria-label={isCompact ? "Expand sidebar" : "Collapse sidebar"}
          aria-keyshortcuts="Meta+B Control+B"
          type="button"
          className="text-ui-muted hover:text-accent"
        >
          {isCompact ? <AppIcons.arrowRight className="h-4 w-4" /> : <AppIcons.arrowLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className={cn("flex-1 py-4", isCompact ? "flex flex-col items-center gap-2 px-0" : "space-y-1 px-2")}>
        {!isCompact ? (
          <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
            Main
          </p>
        ) : null}
        {navItems.map((item) => {
          const Icon = AppIcons[item.icon];
          const active = isActive(item);

          const navLink = (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "ui-motion-color flex items-center text-sm font-medium",
                isCompact ? "h-10 w-10 justify-center rounded-xl border" : "gap-3 rounded-lg px-3 py-2.5",
                active
                  ? "border border-accent bg-accent-soft text-accent"
                  : isCompact
                    ? "border-transparent text-ui-muted hover:bg-[var(--surface-muted)] hover:text-ui-primary"
                    : "text-ui-muted hover:bg-[var(--surface-muted)] hover:text-ui-primary",
              )}
              aria-label={isCompact ? item.label : undefined}
              title={isCompact ? item.label : undefined}
            >
              <Icon className="h-5 w-5" />
              {!isCompact && <span>{item.label}</span>}
            </Link>
          );

          if (!isCompact) {
            return navLink;
          }

          return (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>{navLink}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {classId && (
        <div className={cn(
          "border-t border-default",
          isCompact ? "flex flex-col items-center gap-2 px-0 py-4" : "px-4 py-4",
        )}>
          {!isCompact && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ui-muted">Current Class</p>
          )}

          {isCompact ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/classes/${classId}`}
                  className="ui-motion-color flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-ui-muted hover:bg-[var(--surface-muted)] hover:text-ui-primary"
                  aria-label="Back to Class Home"
                >
                  <AppIcons.classFolder className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Back to Class Home</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              href={`/classes/${classId}`}
              className="ui-motion-color flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ui-muted hover:bg-[var(--surface-muted)] hover:text-ui-primary"
            >
              <AppIcons.classFolder className="h-4 w-4" />
              <span className="truncate">Back to Class Home</span>
            </Link>
          )}

          {(accountType === "teacher" || guestRole === "teacher") && (
            isCompact ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/classes/${classId}/insights`}
                    className={cn(
                      "ui-motion-color flex h-10 w-10 items-center justify-center rounded-xl border",
                      pathname.endsWith("/insights")
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-transparent text-ui-muted hover:bg-[var(--surface-muted)] hover:text-ui-primary",
                    )}
                    aria-label="Insights"
                  >
                    <AppIcons.insights className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Insights</TooltipContent>
              </Tooltip>
            ) : (
              <Link
                href={`/classes/${classId}/insights`}
                className={cn(
                  "ui-motion-color mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted hover:text-ui-primary",
                  pathname.endsWith("/insights") ? "text-accent" : "text-ui-muted",
                )}
              >
                <AppIcons.insights className="h-4 w-4" />
                <span className="truncate">Insights</span>
              </Link>
            )
          )}
        </div>
      )}

      <div className="border-t border-default p-4">
        {!isCompact ? (
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-medium text-ui-muted">
                {displayName.charAt(0).toUpperCase() || "G"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ui-primary">
                  {displayName}
                </p>
                {displayEmail ? (
                  <p className="truncate text-xs font-medium text-ui-muted">{displayEmail}</p>
                ) : null}
                <p className="truncate text-xs text-ui-muted">
                  <span className="capitalize">{roleLabel}</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-medium text-ui-muted">
              {displayName.charAt(0).toUpperCase() || "G"}
            </div>
          </div>
        )}
        {isGuest ? (
          <Link
            href="/register"
            className={cn(
              "mt-3 inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong",
              isCompact ? "w-10 rounded-xl px-0" : "gap-2",
            )}
            aria-label={isCompact ? "Create account" : undefined}
          >
            <AppIcons.add className="h-4 w-4" />
            {!isCompact && <span>Create Account</span>}
          </Link>
        ) : (
          <form action={signOut} className={cn("mt-3", isCompact ? "flex justify-center" : "") }>
            <Button
              type="submit"
              aria-label={isCompact ? "Sign out" : undefined}
              variant="ghost"
              className={cn(
                "text-sm font-medium text-ui-muted hover:bg-[rgba(244,63,94,0.08)] hover:text-[var(--status-error-fg,#9f1239)]",
                isCompact ? "h-10 w-10 rounded-xl px-0" : "justify-start gap-2 rounded-lg px-3 py-2",
              )}
            >
              <AppIcons.logout className="h-4 w-4" />
              {!isCompact && <span>Sign Out</span>}
            </Button>
          </form>
        )}
      </div>
      </motion.aside>
    </TooltipProvider>
  );
}
