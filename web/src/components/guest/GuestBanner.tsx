"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { resetGuestSessionAction, switchGuestRoleAction } from "@/app/actions";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";

type GuestBannerProps = {
  guestRole: "teacher" | "student";
  classId: string;
};

export default function GuestBanner({ guestRole, classId }: GuestBannerProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const otherRole = guestRole === "teacher" ? "student" : "teacher";

  function handleSwitchRole() {
    setMessage(null);
    setIsSwitching(true);
    startTransition(async () => {
      const result = await switchGuestRoleAction(otherRole);
      if (!result.ok) {
        setMessage(result.error ?? "Unable to switch guest view.");
      } else {
        router.refresh();
      }
      setIsSwitching(false);
    });
  }

  function handleReset() {
    setMessage(null);
    setIsResetting(true);
    startTransition(async () => {
      const result = await resetGuestSessionAction();
      if (!result.ok || !result.redirectTo) {
        setMessage(result.error ?? "Unable to reset the guest classroom.");
      } else if (result.redirectTo === `/classes/${classId}`) {
        router.refresh();
      } else {
        router.push(result.redirectTo);
      }
      setIsResetting(false);
    });
  }

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent-primary)_22%,transparent)] bg-accent-soft/60 px-4 py-3 text-sm text-ui-primary shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 text-accent">
            <AppIcons.preview className="h-4 w-4" />
          </span>
          <div className="space-y-1">
            <p className="font-semibold">
              Guest mode is active in <span className="capitalize">{guestRole}</span> view.
            </p>
            <p className="text-ui-muted">
              This sandbox uses live product flows, but all changes are temporary and will be discarded when the session ends.
            </p>
            {message ? <p className="text-[var(--status-error-fg,#9f1239)]">{message}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleSwitchRole} disabled={isSwitching || isResetting}>
            Switch to {otherRole}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={isResetting || isSwitching}>
            Reset sandbox
          </Button>
          <Button asChild variant="warm" size="sm">
            <Link href="/register">Create account</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
