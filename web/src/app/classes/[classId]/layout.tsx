import type { ReactNode } from "react";
import RoleAppShell from "@/app/components/RoleAppShell";
import { requireVerifiedUser } from "@/lib/auth/session";

export default async function ClassRouteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { accountType, user, profile } = await requireVerifiedUser();

  return (
    <RoleAppShell
      accountType={accountType}
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
      classId={classId}
    >
      {children}
    </RoleAppShell>
  );
}
