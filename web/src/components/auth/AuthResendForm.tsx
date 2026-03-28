"use client";

import { useEffect, useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AuthResendFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  authReturnTo: string;
  className?: string;
  cooldownMs?: number;
  defaultEmail: string;
  emailMode?: "editable" | "locked";
  pendingLabel: string;
  resendStartedAt?: string | null;
  submitLabel: string;
  timerReadyCopy: string;
  timerWaitingCopy: string;
};

function getRemainingSeconds(resendStartedAt?: string | null, cooldownMs = 60_000) {
  if (!resendStartedAt) {
    return 0;
  }

  const parsed = Number(resendStartedAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const remainingMs = parsed + cooldownMs - Date.now();
  if (remainingMs <= 0) {
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

export default function AuthResendForm({
  action,
  authReturnTo,
  className,
  cooldownMs = 60_000,
  defaultEmail,
  emailMode = "editable",
  pendingLabel,
  resendStartedAt,
  submitLabel,
  timerReadyCopy,
  timerWaitingCopy,
}: AuthResendFormProps) {
  if (process.env.NODE_ENV !== "production" && !timerWaitingCopy.includes("{seconds}")) {
    console.warn("AuthResendForm: timerWaitingCopy is missing the {seconds} placeholder.");
  }
  const [email, setEmail] = useState(defaultEmail);
  const [remainingSeconds, setRemainingSeconds] = useState(
    getRemainingSeconds(resendStartedAt, cooldownMs),
  );
  const showLockedEmail = emailMode === "locked" && Boolean(email);

  useEffect(() => {
    setEmail(defaultEmail);
  }, [defaultEmail]);

  useEffect(() => {
    setRemainingSeconds(getRemainingSeconds(resendStartedAt, cooldownMs));

    if (!resendStartedAt) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const nextRemaining = getRemainingSeconds(resendStartedAt, cooldownMs);
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [cooldownMs, resendStartedAt]);

  return (
    <form className={cn("space-y-4", className)} action={action}>
      <input type="hidden" name="auth_return_to" value={authReturnTo} />
      {showLockedEmail ? (
        <>
          <input type="hidden" name="email" value={email} />
          <div className="space-y-2">
            <span className="block text-sm font-medium text-ui-muted">Email</span>
            <div className="rounded-xl border border-default bg-white px-3 py-2 text-sm text-ui-primary shadow-xs">
              {email}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      )}
      <PendingSubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        variant="warm"
        className="w-full"
        disabled={remainingSeconds > 0}
      />
      <p className="text-xs leading-5 text-ui-muted" aria-live="polite">
        {remainingSeconds > 0
          ? timerWaitingCopy.replace(
              "{seconds}",
              `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`,
            )
          : timerReadyCopy}
      </p>
    </form>
  );
}
