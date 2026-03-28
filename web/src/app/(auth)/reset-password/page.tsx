import Link from "next/link";
import AuthShell from "@/app/(auth)/AuthShell";
import BrandMark from "@/app/components/BrandMark";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { completePasswordRecovery } from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";

type SearchParams = {
  error?: string;
  recovery?: string;
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const errorMessage =
    typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : null;
  const recoveryReady = resolvedSearchParams?.recovery === "1";

  return (
    <AuthShell>
      <section className="auth-surface relative overflow-hidden rounded-[2rem] border border-default px-5 py-5 sm:px-7 sm:py-7">
        <div className="auth-surface-orb" aria-hidden="true" />
        <div className="relative">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-3">
              <span className="auth-mark flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm">
                <BrandMark className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                  Secure Recovery
                </p>
                <p className="text-sm font-medium text-ui-muted">Learning Platform</p>
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="editorial-title text-3xl leading-tight text-ui-primary sm:text-[2.4rem]">
                Choose a new password
              </h1>
              <p className="max-w-[34ch] text-sm leading-6 text-ui-muted sm:text-[15px]">
                Set a fresh password for your account. Once saved, sign in again with the new
                credentials.
              </p>
            </div>
          </div>

          <div className="mt-6 border-t border-default pt-5">
            {recoveryReady ? (
              <Alert variant="success" className="mb-4">
                Your reset link is confirmed. Enter a new password to finish recovery.
              </Alert>
            ) : null}

            {errorMessage ? (
              <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-4" />
            ) : null}

            <form className="space-y-4" action={completePasswordRecovery}>
              <div className="space-y-2">
                <Label htmlFor="new_password">New password</Label>
                <PasswordInput
                  id="new_password"
                  name="new_password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  pattern={PASSWORD_POLICY_PATTERN}
                  title={PASSWORD_POLICY_TITLE}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirm new password</Label>
                <PasswordInput
                  id="confirm_password"
                  name="confirm_password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  pattern={PASSWORD_POLICY_PATTERN}
                  title={PASSWORD_POLICY_TITLE}
                  autoComplete="new-password"
                />
              </div>
              <p className="text-xs leading-5 text-ui-muted">{PASSWORD_POLICY_HINT}</p>
              <PendingSubmitButton
                label="Save new password"
                pendingLabel="Saving password..."
                variant="warm"
                className="w-full"
              />
            </form>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-5 text-sm text-ui-muted">
            <span>Need another link?</span>
            <Link className="ui-motion-color link-warm font-semibold" href="/forgot-password">
              Request password reset
            </Link>
          </div>
        </div>
      </section>
    </AuthShell>
  );
}
