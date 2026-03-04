import type { ReactNode } from "react";
import AuthHeader, { type AuthHeaderProps } from "@/app/components/AuthHeader";
import { cn } from "@/lib/utils";

type HeaderPageShellProps = Pick<
  AuthHeaderProps,
  "activeNav" | "accountType" | "breadcrumbs" | "classContext" | "tone"
> & {
  children: ReactNode;
  maxWidthClassName?: string;
};

export default function HeaderPageShell({
  activeNav,
  accountType,
  breadcrumbs,
  classContext,
  tone,
  children,
  maxWidthClassName = "max-w-3xl",
}: HeaderPageShellProps) {
  return (
    <div className="surface-page min-h-screen text-ui-primary">
      <AuthHeader
        activeNav={activeNav}
        accountType={accountType}
        breadcrumbs={breadcrumbs}
        classContext={classContext}
        tone={tone}
      />
      <div className={cn("mx-auto w-full px-6 py-16", maxWidthClassName)}>{children}</div>
    </div>
  );
}
