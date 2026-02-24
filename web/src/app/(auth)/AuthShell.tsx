import Link from "next/link";
import type { ReactNode } from "react";
import AmbientBackground from "@/app/components/AmbientBackground";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  footerLabel: string;
  footerLinkLabel: string;
  footerHref: string;
  children: ReactNode;
};

export default function AuthShell({
  eyebrow,
  title,
  description,
  footerLabel,
  footerLinkLabel,
  footerHref,
  children,
}: AuthShellProps) {
  return (
    <div className="surface-page relative min-h-screen overflow-hidden">
      <AmbientBackground />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-10">
        <Link
          className="ui-motion-color inline-flex w-fit items-center gap-2 rounded-full border border-[#d8cdbb] bg-white/95 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-[#c8a786] hover:text-[#884a35]"
          href="/"
          aria-label="Back to home"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Home
        </Link>

        <div className="grid flex-1 items-center gap-8 lg:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
          <section className="hero-card rounded-[2rem] border-[#ddd2c2] bg-white/90 p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8c4a35]">{eyebrow}</p>
            <h1 className="editorial-title mt-4 text-4xl leading-tight text-slate-900">{title}</h1>
            <p className="mt-4 text-sm text-slate-600">{description}</p>
            <div className="mt-8 space-y-3 text-sm text-slate-600">
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b76a51]" />
                Blueprint-first workflow with teacher control.
              </p>
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b76a51]" />
                Consistent class context across every AI activity.
              </p>
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b76a51]" />
                Secure roles for teachers and students.
              </p>
            </div>
          </section>

          <section className="surface-card rounded-[2rem] p-8 shadow-sm">
            {children}
            <div className="mt-7 flex items-center justify-between text-sm text-slate-500">
              <span>{footerLabel}</span>
              <Link className="ui-motion-color link-warm font-semibold" href={footerHref}>
                {footerLinkLabel}
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
