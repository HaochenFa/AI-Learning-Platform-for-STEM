import type { ReactNode } from "react";
import Sidebar from "@/app/components/Sidebar";
import type { AccountType } from "@/lib/auth/session";

type RoleAppShellProps = {
  accountType: AccountType;
  userEmail?: string;
  userDisplayName?: string | null;
  classId?: string;
  children: ReactNode;
};

export default function RoleAppShell({
  accountType,
  userEmail,
  userDisplayName,
  classId,
  children,
}: RoleAppShellProps) {
  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType={accountType}
        userEmail={userEmail}
        userDisplayName={userDisplayName}
        classId={classId}
      />
      <div className="sidebar-content">{children}</div>
    </div>
  );
}
