import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SidebarLoadingScaffoldProps = {
  children: ReactNode;
  maxWidthClassName?: string;
  mainClassName?: string;
  navItemCount?: number;
};

export function SidebarLoadingScaffold({
  children,
  maxWidthClassName = "max-w-5xl",
  mainClassName,
  navItemCount = 4,
}: SidebarLoadingScaffoldProps) {
  return (
    <div className="surface-page min-h-screen">
      <div className="fixed left-0 top-0 h-screen w-[var(--sidebar-width)] border-r border-default bg-white">
        <div className="flex h-16 items-center justify-between border-b border-default px-4">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <div className="space-y-1 px-2 py-4">
          {Array.from({ length: navItemCount }).map((_, i) => (
            <Skeleton key={`sidebar-skeleton-nav-${i}`} className="h-10 rounded-lg bg-[var(--surface-muted)]" />
          ))}
        </div>
      </div>

      <div className="sidebar-content">
        <main className={cn("mx-auto w-full p-6 pt-16", maxWidthClassName, mainClassName)} aria-busy="true">
          {children}
        </main>
      </div>
    </div>
  );
}

type HeaderLoadingScaffoldProps = {
  children: ReactNode;
  maxWidthClassName?: string;
  contentClassName?: string;
};

export function HeaderLoadingScaffold({
  children,
  maxWidthClassName = "max-w-6xl",
  contentClassName,
}: HeaderLoadingScaffoldProps) {
  return (
    <div className="surface-page min-h-screen">
      <div className="border-b border-default bg-white/90">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <Skeleton className="h-3 w-52" />
          <Skeleton className="h-8 w-56 rounded-full" />
        </div>
      </div>
      <div
        className={cn("mx-auto w-full space-y-8 px-6 py-16", maxWidthClassName, contentClassName)}
        aria-busy="true"
      >
        {children}
      </div>
    </div>
  );
}
