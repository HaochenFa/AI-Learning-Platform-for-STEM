import Link from "next/link";
import { signOut } from "@/app/actions";

type Breadcrumb = {
  label: string;
  href?: string;
};

type AuthHeaderProps = {
  breadcrumbs?: Breadcrumb[];
};

export default function AuthHeader({ breadcrumbs }: AuthHeaderProps) {
  return (
    <div className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Link
          href="/dashboard"
          className="text-xs uppercase tracking-[0.35em] text-slate-400 transition hover:text-slate-200"
        >
          STEM Learning Platform
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/dashboard"
            className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
          >
            Dashboard
          </Link>
          <Link
            href="/classes/new"
            className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
          >
            New class
          </Link>
          <Link
            href="/join"
            className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
          >
            Join class
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-6 pb-6">
          <nav className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              if (crumb.href && !isLast) {
                return (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                    <Link href={crumb.href} className="hover:text-slate-300">
                      {crumb.label}
                    </Link>
                    <span className="text-slate-600">/</span>
                  </span>
                );
              }
              return (
                <span key={`${crumb.label}-${index}`} className="text-slate-300">
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
