import Link from "next/link";
import type { ReactNode } from "react";
import AmbientBackground from "@/app/components/AmbientBackground";
import { AppIcons } from "@/components/icons";
import { Card } from "@/components/ui/card";

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
          className="ui-motion-color inline-flex w-fit items-center gap-2 rounded-full border border-default bg-white/95 px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:text-accent"
          href="/"
          aria-label="Back to home"
        >
          <AppIcons.arrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Home
        </Link>

        <div className="grid flex-1 items-center gap-8 lg:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
          <Card className="hero-card rounded-[2rem] border-default bg-white/90 p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
            <h1 className="editorial-title mt-4 text-4xl leading-tight text-ui-primary">{title}</h1>
            <p className="mt-4 text-sm text-ui-muted">{description}</p>
            <div className="mt-8 space-y-3 text-sm text-ui-muted">
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Blueprint-first workflow with teacher control.
              </p>
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Consistent class context across every AI activity.
              </p>
              <p className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Secure roles for teachers and students.
              </p>
            </div>
          </Card>

          <Card className="rounded-[2rem] p-8">
            {children}
            <div className="mt-7 flex items-center justify-between text-sm text-ui-muted">
              <span>{footerLabel}</span>
              <Link className="ui-motion-color link-warm font-semibold" href={footerHref}>
                {footerLinkLabel}
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
