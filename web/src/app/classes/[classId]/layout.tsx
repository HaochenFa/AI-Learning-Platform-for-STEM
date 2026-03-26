import type { ReactNode } from "react";
import RoleAppShell from "@/app/components/RoleAppShell";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";
import { touchGuestSandbox } from "@/lib/guest/sandbox";

export default async function ClassRouteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const context = await requireGuestOrVerifiedUser();

  if (context.isGuest && context.sandboxId) {
    await touchGuestSandbox(context.sandboxId);
  }

  return (
    <RoleAppShell
      accountType={context.accountType}
      userEmail={context.user.email ?? undefined}
      userDisplayName={context.profile.display_name}
      classId={classId}
      isGuest={context.isGuest}
      guestRole={context.guestRole}
    >
      {children}
    </RoleAppShell>
  );
}
