"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/actions";
import type { AccountType } from "@/lib/auth/session";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

const teacherNavItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/teacher/dashboard",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    ),
  },
  {
    label: "My Classes",
    href: "/teacher/dashboard#classes",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
        />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: "Help",
    href: "/help",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
        />
      </svg>
    ),
  },
];

const studentNavItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/student/dashboard",
    icon: teacherNavItems[0].icon,
  },
  {
    label: "My Classes",
    href: "/student/dashboard#classes",
    icon: teacherNavItems[1].icon,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: teacherNavItems[2].icon,
  },
  {
    label: "Help",
    href: "/help",
    icon: teacherNavItems[3].icon,
  },
];

type SidebarProps = {
  accountType: AccountType;
  userEmail?: string;
  classId?: string;
};

const COLLAPSED_KEY = "ui.sidebar.collapsed";

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      {collapsed ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      )}
    </svg>
  );
}

export default function Sidebar({ accountType, userEmail, classId }: SidebarProps) {
  const pathname = usePathname();
  const [currentHash, setCurrentHash] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.location.hash;
  });
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
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, [pathname]);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, isCollapsed ? "true" : "false");
    const root = document.documentElement;
    root.style.setProperty("--sidebar-width", isCompact ? "5rem" : "16rem");
    return () => {
      root.style.setProperty("--sidebar-width", "16rem");
    };
  }, [isCollapsed, isCompact]);

  const navItems = accountType === "teacher" ? teacherNavItems : studentNavItems;

  const isActive = (href: string) => {
    const [baseHref, hashTarget] = href.split("#");
    if (hashTarget) {
      return pathname === baseHref && currentHash === `#${hashTarget}`;
    }
    if (baseHref === "/teacher/dashboard" || baseHref === "/student/dashboard") {
      return pathname === baseHref && currentHash !== "#classes";
    }
    return pathname.startsWith(baseHref);
  };

  return (
    <aside
      className="fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-slate-200 bg-white transition-all duration-300"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        {!isCompact && (
          <Link
            href={accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard"}
            className="flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900">STEM</span>
          </Link>
        )}
        <button
          onClick={() => setIsCollapsed((value) => !value)}
          className="ui-motion-color flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
          aria-label={isCompact ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <SidebarToggleIcon collapsed={isCompact} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`ui-motion-color flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
              isActive(item.href)
                ? "bg-cyan-50 text-cyan-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
            title={isCompact ? item.label : undefined}
          >
            {item.icon}
            {!isCompact && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>

      {classId && !isCompact && (
        <div className="border-t border-slate-200 px-4 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Current Class</p>
          <Link
            href={`/classes/${classId}`}
            className="ui-motion-color flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <span className="truncate">View Class</span>
          </Link>
        </div>
      )}

      <div className="border-t border-slate-200 p-4">
        {!isCompact ? (
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                {userEmail?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{userEmail}</p>
                <p className="truncate text-xs text-slate-500">
                  {accountType === "teacher" ? "Teacher" : "Student"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
              {userEmail?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        )}
        <form action={signOut} className={`mt-3 ${isCompact ? "flex justify-center" : ""}`}>
          <button
            type="submit"
            className={`ui-motion-color flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 ${
              isCompact ? "w-full" : ""
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
              />
            </svg>
            {!isCompact && <span>Sign Out</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
