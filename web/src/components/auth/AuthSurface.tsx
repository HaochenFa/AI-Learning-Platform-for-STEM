import Link from "next/link";
import BrandMark from "@/app/components/BrandMark";
import AccountTypeSelector from "@/components/auth/AccountTypeSelector";
import AuthResendForm from "@/components/auth/AuthResendForm";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import {
  requestPasswordReset,
  resendConfirmationEmail,
  resendPasswordReset,
  signIn,
  signUp,
} from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";
import {
  buildRedirectUrl,
  getAuthHref,
  parseAuthResendFlow,
  type AuthMode,
  type AuthPresentation,
  type AuthSearchParams,
} from "@/lib/auth/ui";

type AuthSurfaceProps = {
  mode: AuthMode;
  presentation: AuthPresentation;
  searchParams?: AuthSearchParams;
};

type AuthCopy = {
  eyebrow: string;
  title: string;
  description?: string;
  footerLabel: string;
  footerMode: AuthMode;
  footerLinkLabel: string;
};

const AUTH_COPY: Record<AuthMode, AuthCopy> = {
  "sign-in": {
    eyebrow: "Teacher + Student Access",
    title: "Welcome back",
    description:
      "Sign in to manage classes, review AI outputs, and keep every student workflow grounded in your blueprint.",
    footerLabel: "New here?",
    footerMode: "sign-up",
    footerLinkLabel: "Create an account",
  },
  "sign-up": {
    eyebrow: "Launch Your Class",
    title: "Create an account",
    footerLabel: "Already have an account?",
    footerMode: "sign-in",
    footerLinkLabel: "Sign in",
  },
  "forgot-password": {
    eyebrow: "Account Recovery",
    title: "Reset your password",
    description:
      "We will email a secure recovery link so you can get back into your workspace without losing momentum.",
    footerLabel: "Remembered your password?",
    footerMode: "sign-in",
    footerLinkLabel: "Back to sign in",
  },
};

function getReturnTo(mode: AuthMode, presentation: AuthPresentation) {
  return getAuthHref(mode, presentation);
}

function getSuccessReturnTo(mode: AuthMode, presentation: AuthPresentation) {
  return getAuthHref(mode, presentation);
}

function getHiddenRedirectFields(mode: AuthMode, presentation: AuthPresentation) {
  return {
    authReturnTo: getReturnTo(mode, presentation),
    authSuccessTo: getSuccessReturnTo(mode, presentation),
  };
}

function getFooterHref(mode: AuthMode, presentation: AuthPresentation) {
  return getAuthHref(AUTH_COPY[mode].footerMode, presentation);
}

function getSupportHref(mode: AuthMode, presentation: AuthPresentation) {
  if (mode === "sign-in") {
    return getAuthHref("forgot-password", presentation);
  }

  return getAuthHref("sign-in", presentation);
}

function getSupportLabel(mode: AuthMode) {
  if (mode === "sign-in") {
    return "Forgot password?";
  }

  return "Use a different auth path";
}

export default function AuthSurface({
  mode,
  presentation,
  searchParams,
}: AuthSurfaceProps) {
  const copy = AUTH_COPY[mode];
  const errorMessage =
    typeof searchParams?.error === "string" ? searchParams.error : null;
  const verify = searchParams?.verify === "1";
  const confirmed = searchParams?.confirmed === "1";
  const reset = searchParams?.reset === "1";
  const sent = searchParams?.sent === "1";
  const guestReady = searchParams?.guest === "ready";
  const resendFlow = parseAuthResendFlow(
    typeof searchParams?.resend === "string" ? searchParams.resend : null,
  );
  const resendStartedAt =
    typeof searchParams?.resend_started_at === "string"
      ? searchParams.resend_started_at
      : null;
  const defaultEmail =
    typeof searchParams?.email === "string" ? searchParams.email : "";
  const defaultAccountType =
    searchParams?.account_type === "student"
      ? "student"
      : searchParams?.account_type === "teacher"
        ? "teacher"
        : null;
  const signUpResendActive = mode === "sign-up" && (verify || resendFlow === "confirmation");
  const forgotPasswordResendActive = mode === "forgot-password" && (sent || resendFlow === "reset");
  const { authReturnTo, authSuccessTo } = getHiddenRedirectFields(mode, presentation);
  const signUpResendReturnTo = buildRedirectUrl(authReturnTo, {
    account_type: defaultAccountType,
  });
  const footerHref = getFooterHref(mode, presentation);
  const supportHref = getSupportHref(mode, presentation);
  const supportLabel = getSupportLabel(mode);
  const linkProps = presentation === "modal" ? { scroll: false } : {};

  const renderLoginFeedback = mode === "sign-in" ? (
    <>
      {confirmed ? (
        <Alert variant="success" className="mb-4">
          Your email has been verified. You can sign in now.
        </Alert>
      ) : null}

      {reset ? (
        <Alert variant="success" className="mb-4">
          Your password has been reset. Sign in with your new password.
        </Alert>
      ) : null}
    </>
  ) : null;

  const renderSignUpFeedback = mode === "sign-up" ? (
    <>
      {verify ? (
        <Alert variant="success" className="mb-4">
          Check your email to verify your account. Confirmation links expire after 5 minutes.
        </Alert>
      ) : null}

      {guestReady ? (
        <Alert variant="success" className="mb-4">
          Your guest classroom has been discarded. Finish creating your account to continue with a
          fresh permanent workspace.
        </Alert>
      ) : null}
    </>
  ) : null;

  const renderForgotFeedback = mode === "forgot-password" ? (
    <>
      {sent ? (
        <Alert variant="success" className="mb-4">
          If an account exists for that email, we&apos;ve sent a password reset link. Reset links
          expire after 5 minutes.
        </Alert>
      ) : null}
    </>
  ) : null;

  return (
    <section
      className={[
        "auth-surface relative rounded-[2rem] border border-default px-5 py-5 sm:px-7 sm:py-6",
        presentation === "modal" ? "auth-surface-modal" : "",
      ].join(" ")}
    >
      <div className="auth-surface-orb" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-3">
              <span className="auth-mark flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm">
                <BrandMark className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                  {copy.eyebrow}
                </p>
                <p className="text-sm font-medium text-ui-muted">Learning Platform</p>
              </div>
            </div>
            <div className="max-w-[30rem] space-y-2">
              <h1 className="editorial-title text-3xl leading-tight text-ui-primary sm:text-[2.4rem]">
                {copy.title}
              </h1>
              {copy.description ? (
                <p className="max-w-[34ch] text-sm leading-6 text-ui-muted sm:text-[15px]">
                  {copy.description}
                </p>
              ) : null}
            </div>
          </div>

          {presentation === "modal" ? (
            <DialogClose className="auth-close ui-motion-color flex h-10 w-10 items-center justify-center rounded-2xl border border-default bg-white/88 text-ui-muted hover:border-accent hover:text-accent">
              <span className="sr-only">Close auth dialog</span>
              ×
            </DialogClose>
          ) : null}
        </div>

        <div className="mt-5 border-t border-default pt-4">
          {renderLoginFeedback}
          {renderSignUpFeedback}
          {renderForgotFeedback}

          {errorMessage ? (
            <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-4" />
          ) : null}

          {mode === "sign-in" ? (
            <form className="space-y-4" action={signIn}>
              <input type="hidden" name="auth_return_to" value={authReturnTo} />
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href={supportHref}
                    className="ui-motion-color text-xs font-semibold text-ui-muted hover:text-accent"
                    {...linkProps}
                  >
                    {supportLabel}
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <PendingSubmitButton
                label="Sign in"
                pendingLabel="Signing in..."
                variant="warm"
                className="w-full"
              />
            </form>
          ) : null}

          {mode === "sign-up" ? (
            <>
              <form className="space-y-4" action={signUp}>
                <input type="hidden" name="auth_return_to" value={authReturnTo} />
                <input type="hidden" name="auth_success_to" value={authSuccessTo} />
                <AccountTypeSelector defaultValue={defaultAccountType} />
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    defaultValue={defaultEmail}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password"
                    name="password"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    pattern={PASSWORD_POLICY_PATTERN}
                    title={PASSWORD_POLICY_TITLE}
                    autoComplete="new-password"
                  />
                  <p className="text-xs leading-5 text-ui-muted">{PASSWORD_POLICY_HINT}</p>
                </div>
                <PendingSubmitButton
                  label="Create account"
                  pendingLabel="Creating account..."
                  variant="warm"
                  className="w-full"
                />
              </form>
              {signUpResendActive && defaultEmail ? (
                <div className="mt-4 space-y-3 border-t border-default pt-4">
                  <p className="text-sm text-ui-muted">
                    If your email address is wrong, update it above and click{" "}
                    <strong>Create account</strong> again.
                  </p>
                  <AuthResendForm
                    action={resendConfirmationEmail}
                    authReturnTo={signUpResendReturnTo}
                    defaultEmail={defaultEmail}
                    emailMode="locked"
                    pendingLabel="Resending confirmation email..."
                    resendStartedAt={resendStartedAt}
                    submitLabel="Resend confirmation email"
                    timerReadyCopy="Confirmation links stay valid for 5 minutes. You can request a new email now."
                    timerWaitingCopy="You can resend another email in {seconds}. Confirmation links stay valid for 5 minutes."
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {mode === "forgot-password" ? (
            forgotPasswordResendActive ? (
              <AuthResendForm
                action={resendPasswordReset}
                authReturnTo={authReturnTo}
                defaultEmail={defaultEmail}
                pendingLabel="Resending reset email..."
                resendStartedAt={resendStartedAt}
                submitLabel="Resend reset email"
                timerReadyCopy="Reset links expire after 5 minutes. You can request a new email now."
                timerWaitingCopy="You can resend another email in {seconds}. Reset links expire after 5 minutes."
              />
            ) : (
              <form className="space-y-4" action={requestPasswordReset}>
                <input type="hidden" name="auth_return_to" value={authReturnTo} />
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </div>
                <PendingSubmitButton
                  label="Send reset link"
                  pendingLabel="Sending link..."
                  variant="warm"
                  className="w-full"
                />
              </form>
            )
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-5 text-sm text-ui-muted">
          <span>{copy.footerLabel}</span>
          <Link
            href={footerHref}
            className="ui-motion-color link-warm font-semibold"
            {...linkProps}
          >
            {copy.footerLinkLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
