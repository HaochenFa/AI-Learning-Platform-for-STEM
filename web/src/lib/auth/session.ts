import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AccountType = "teacher" | "student";
export type GuestRole = AccountType;

type ProfileRow = {
  id: string;
  account_type: AccountType | null;
  display_name: string | null;
};

type GuestSandboxRow = {
  id: string;
  class_id: string | null;
  guest_role: GuestRole;
  status: "active" | "expired" | "discarded";
};

export type AuthContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
  >["data"]["user"];
  accessToken: string | null;
  profile: ProfileRow | null;
  isEmailVerified: boolean;
  isGuest: boolean;
  sandboxId: string | null;
  guestRole: GuestRole | null;
  guestClassId: string | null;
};

function loginErrorUrl(message: string) {
  return `/login?error=${encodeURIComponent(message)}`;
}

function isAnonymousUser(
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
  >["data"]["user"],
) {
  if (!user) {
    return false;
  }

  const candidate = user as {
    is_anonymous?: boolean;
    app_metadata?: { provider?: string | null } | null;
  };

  return candidate.is_anonymous === true || candidate.app_metadata?.provider === "anonymous";
}

export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) {
    return {
      supabase,
      user: null,
      accessToken: null,
      profile: null,
      isEmailVerified: false,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    };
  }

  let profile: ProfileRow | null = null;
  let isGuest = false;
  let sandboxId: string | null = null;
  let guestRole: GuestRole | null = null;
  let guestClassId: string | null = null;

  if (isAnonymousUser(user)) {
    const { data: sandbox } = await supabase
      .from("guest_sandboxes")
      .select("id,class_id,guest_role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle<GuestSandboxRow>();

    if (sandbox) {
      isGuest = true;
      sandboxId = sandbox.id;
      guestRole = sandbox.guest_role;
      guestClassId = sandbox.class_id;
    }
  } else {
    const { data } = await supabase
      .from("profiles")
      .select("id,account_type,display_name")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    profile = data ?? null;
  }

  return {
    supabase,
    user,
    accessToken: session?.access_token ?? null,
    profile,
    isEmailVerified: Boolean(user.email_confirmed_at),
    isGuest,
    sandboxId,
    guestRole,
    guestClassId,
  };
}

export async function requireVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const context = await getAuthContext();
  if (!context.user) {
    redirect("/login");
  }

  if (context.isGuest) {
    if (context.guestClassId) {
      redirect(`/classes/${context.guestClassId}`);
    }
    redirect("/");
  }

  if (!context.isEmailVerified) {
    redirect(loginErrorUrl("Please verify your email before continuing."));
  }

  const accountType = context.profile?.account_type;
  if (!accountType) {
    redirect(loginErrorUrl("Account setup is incomplete. Please sign in again."));
  }

  if (options?.accountType && accountType !== options.accountType) {
    const fallback = accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard";
    const destination = options.redirectPath ?? fallback;
    redirect(
      `${destination}?error=${encodeURIComponent(
        `This action requires a ${options.accountType} account.`,
      )}`,
    );
  }

  return {
    ...context,
    user: context.user,
    profile: {
      id: context.user.id,
      account_type: accountType,
      display_name: context.profile?.display_name ?? null,
    },
    accountType,
    isEmailVerified: true,
  };
}

export async function requireGuestOrVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const context = await getAuthContext();
  if (!context.user) {
    redirect("/login");
  }

  if (context.isGuest) {
    const accountType = context.guestRole;
    if (!accountType) {
      redirect("/");
    }

    if (options?.accountType && accountType !== options.accountType) {
      const fallback = context.guestClassId ? `/classes/${context.guestClassId}` : "/";
      const destination = options.redirectPath ?? fallback;
      redirect(
        `${destination}?error=${encodeURIComponent(
          `This action requires a ${options.accountType} view.`,
        )}`,
      );
    }

    return {
      ...context,
      user: context.user,
      profile: {
        id: context.user.id,
        account_type: accountType,
        display_name: "Guest Explorer",
      } satisfies ProfileRow,
      accountType,
      isEmailVerified: true,
    };
  }

  return requireVerifiedUser(options);
}
