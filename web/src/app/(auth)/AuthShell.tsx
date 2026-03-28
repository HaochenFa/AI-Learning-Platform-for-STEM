import Link from "next/link";
import type { ReactNode } from "react";
import AmbientBackground from "@/app/components/AmbientBackground";
import BrandMark from "@/app/components/BrandMark";
import { AppIcons } from "@/components/icons";

type AuthShellProps = {
  children: ReactNode;
};

export default function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="surface-page relative min-h-screen overflow-hidden">
      <AmbientBackground />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <Link
            className="ui-motion-color inline-flex w-fit items-center gap-2 rounded-full border border-default bg-[var(--surface-page)]/92 px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:text-accent"
            href="/"
            aria-label="Back to home"
          >
            <AppIcons.arrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Home
          </Link>

          <div className="hidden items-center gap-2 text-sm font-semibold tracking-wide text-ui-subtle sm:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground text-white shadow-sm">
              <BrandMark className="h-4 w-4" />
            </span>
            Learning Platform
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-[34rem]">{children}</div>
        </div>
      </div>
    </div>
  );
}
