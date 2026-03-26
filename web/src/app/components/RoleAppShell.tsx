import type { ReactNode } from "react";
import Sidebar from "@/app/components/Sidebar";
import GuestBanner from "@/components/guest/GuestBanner";
import type { AccountType } from "@/lib/auth/session";

type RoleAppShellProps = {
  accountType: AccountType;
  userEmail?: string;
  userDisplayName?: string | null;
  classId?: string;
  isGuest?: boolean;
  guestRole?: AccountType | null;
  children: ReactNode;
};

export default function RoleAppShell({
  accountType,
  userEmail,
  userDisplayName,
  classId,
  isGuest = false,
  guestRole = null,
  children,
}: RoleAppShellProps) {
  return (
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType={accountType}
        userEmail={userEmail}
        userDisplayName={userDisplayName}
        classId={classId}
        isGuest={isGuest}
        guestRole={guestRole}
      />
      <div className="sidebar-content">
        {isGuest && classId && guestRole ? (
          <div className="mx-auto w-full max-w-6xl px-6 pt-6">
            <GuestBanner guestRole={guestRole} classId={classId} />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
