"use server";

import { GUEST_SESSION_MAX_AGE_MS } from "@/lib/guest/config";
import {
  getGuestSessionExpiredMessage,
  isGuestSandboxExpired,
} from "@/lib/guest/session-expiry";
import { consumeGuestEntryRateLimit } from "@/lib/guest/entry-rate-limit";
import { type GuestProvisionFailureCode } from "@/lib/guest/errors";
import { isGuestMutableStoragePath } from "@/lib/guest/storage";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type GuestSandboxResult =
  | {
      ok: true;
      classId: string;
      sandboxId: string;
    }
  | {
      ok: false;
      code: GuestProvisionFailureCode;
      error: string;
      reason?: string;
    };

type ActiveSandboxRow = {
  id: string;
  class_id: string | null;
  status: "active" | "expired" | "discarded";
  guest_role: "teacher" | "student";
  expires_at: string | null;
  last_seen_at: string | null;
};

const MATERIALS_BUCKET = "materials";
type GuestMaterialStorageRow = {
  storage_path: string | null;
};

function isMaybeSingleNoRowsError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "PGRST116";
}

function isAnonymousUser(user: {
  is_anonymous?: boolean;
  app_metadata?: { provider?: string | null } | null;
} | null | undefined) {
  return user?.is_anonymous === true || user?.app_metadata?.provider === "anonymous";
}

async function expireGuestSandbox(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sandboxId: string,
) {
  await supabase
    .from("guest_sandboxes")
    .update({
      status: "expired",
    })
    .eq("id", sandboxId)
    .eq("status", "active");
}

async function removeGuestSandboxStorageObjects(
  sandboxId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const adminSupabase = createAdminSupabaseClient();
  const { data: materials, error: materialsError } = await adminSupabase
    .from("materials")
    .select("storage_path")
    .eq("sandbox_id", sandboxId);

  if (materialsError) {
    return { ok: false, error: materialsError.message };
  }

  const materialRows = (materials ?? []) as GuestMaterialStorageRow[];
  const storagePaths = Array.from(
    new Set(
      materialRows
        .map((material) => material.storage_path)
        .filter((path): path is string => typeof path === "string" && isGuestMutableStoragePath(path, sandboxId)),
    ),
  );

  if (storagePaths.length === 0) {
    return { ok: true };
  }

  const { error: removeError } = await adminSupabase.storage
    .from(MATERIALS_BUCKET)
    .remove(storagePaths);

  if (removeError) {
    return { ok: false, error: removeError.message };
  }

  return { ok: true };
}

export async function provisionGuestSandbox(): Promise<GuestSandboxResult> {
  return provisionGuestSandboxWithOptions();
}

export async function provisionGuestSandboxWithOptions(options?: {
  ipAddress?: string | null;
}): Promise<GuestSandboxResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { session: existingSession },
  } = await supabase.auth.getSession();
  const existingUser = existingSession?.user ?? null;
  const existingUserIsAnonymous = isAnonymousUser(existingUser);
  let guestUserId = existingUserIsAnonymous ? existingUser?.id ?? null : null;
  let shouldSignOutOnFailure = false;

  if (existingUser) {
    const { data: existingSandbox, error: existingSandboxError } = await supabase
      .from("guest_sandboxes")
      .select("id,class_id,status,guest_role,expires_at,last_seen_at")
      .eq("user_id", existingUser.id)
      .eq("status", "active")
      .maybeSingle<ActiveSandboxRow>();

    if (existingSandboxError && !isMaybeSingleNoRowsError(existingSandboxError)) {
      return {
        ok: false,
        code: "guest-session-check-failed",
        error: "We couldn't verify your current guest session. Please try again.",
        reason: "existing-session-check",
      };
    }

    if (existingSandbox && isGuestSandboxExpired(existingSandbox)) {
      await expireGuestSandbox(supabase, existingSandbox.id);

      if (!existingUserIsAnonymous) {
        return {
          ok: false,
          code: "guest-session-conflict",
          error: getGuestSessionExpiredMessage(),
          reason: "expired-non-anonymous-session",
        };
      }

      await supabase.auth.signOut();
      guestUserId = null;
    }

    if (existingSandbox?.class_id && !isGuestSandboxExpired(existingSandbox)) {
      return {
        ok: true,
        classId: existingSandbox.class_id,
        sandboxId: existingSandbox.id,
      };
    }

    if (!existingUserIsAnonymous) {
      return {
        ok: false,
        code: "guest-session-conflict",
        error: "Please sign out before starting a guest session.",
        reason: "existing-authenticated-session",
      };
    }

    if (existingSandbox?.id && !isGuestSandboxExpired(existingSandbox)) {
      const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
        p_sandbox_id: existingSandbox.id,
        p_guest_user_id: existingUser.id,
      });

      if (cloneError || typeof classId !== "string" || !classId) {
        return {
          ok: false,
          code: "guest-sandbox-provision-failed",
          error: cloneError?.message ?? "Failed to provision the guest classroom.",
          reason: "existing-anonymous-clone",
        };
      }

      return {
        ok: true,
        classId,
        sandboxId: existingSandbox.id,
      };
    }
  }

  if (options?.ipAddress) {
    let allowed: boolean;
    try {
      allowed = await consumeGuestEntryRateLimit(options.ipAddress);
    } catch {
      return {
        ok: false,
        code: "guest-unavailable",
        error: "guest-unavailable",
        reason: "entry-rate-limit-check",
      };
    }

    if (!allowed) {
      return {
        ok: false,
        code: "too-many-guest-sessions",
        error: "too-many-guest-sessions",
        reason: "entry-rate-limit-exceeded",
      };
    }
  }

  if (!guestUserId) {
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !authData.user) {
      return {
        ok: false,
        code: "guest-auth-unavailable",
        error: authError?.message ?? "Failed to create an anonymous guest session.",
        reason: "anonymous-auth",
      };
    }

    guestUserId = authData.user.id;
    shouldSignOutOnFailure = true;
  }

  if (!guestUserId) {
    return {
      ok: false,
      code: "guest-auth-unavailable",
      error: "Failed to create an anonymous guest session.",
      reason: "anonymous-auth-missing-user",
    };
  }

  const sandboxId = crypto.randomUUID();
  const { error: sandboxError } = await supabase.from("guest_sandboxes").insert({
    id: sandboxId,
    user_id: guestUserId,
    guest_role: "teacher",
    status: "active",
    expires_at: new Date(Date.now() + GUEST_SESSION_MAX_AGE_MS).toISOString(),
  });

  if (sandboxError) {
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: `Failed to create a guest sandbox: ${sandboxError.message}`,
      reason: "sandbox-insert",
    };
  }

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: guestUserId,
  });

  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: cloneError?.message ?? "Failed to provision the guest classroom.",
      reason: "sandbox-clone",
    };
  }

  return { ok: true, classId, sandboxId };
}

export async function switchGuestRole(
  sandboxId: string,
  newRole: "teacher" | "student",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("guest_sandboxes")
    .update({
      guest_role: newRole,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", sandboxId)
    .eq("status", "active");

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function touchGuestSandbox(
  sandboxId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("guest_sandboxes")
    .update({
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", sandboxId)
    .eq("status", "active");

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function discardGuestSandbox(
  sandboxId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();

  const storageCleanup = await removeGuestSandboxStorageObjects(sandboxId);
  if (!storageCleanup.ok) {
    return { ok: false, error: storageCleanup.error };
  }

  const { error } = await supabase.rpc("discard_guest_sandbox", {
    p_sandbox_id: sandboxId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function resetGuestSandbox(userId: string): Promise<GuestSandboxResult> {
  const supabase = await createServerSupabaseClient();

  const { data: existingSandbox, error: existingSandboxError } = await supabase
    .from("guest_sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();

  if (existingSandboxError && !isMaybeSingleNoRowsError(existingSandboxError)) {
    return {
      ok: false,
      error: "We couldn't verify your current guest session. Please try again.",
    };
  }

  if (existingSandbox?.id) {
    const discarded = await discardGuestSandbox(existingSandbox.id);
    if (!discarded.ok) {
      return { ok: false, error: discarded.error ?? "Failed to discard the old guest sandbox." };
    }
  }

  const sandboxId = crypto.randomUUID();
  const { error: sandboxError } = await supabase.from("guest_sandboxes").insert({
    id: sandboxId,
    user_id: userId,
    guest_role: "teacher",
    status: "active",
    expires_at: new Date(Date.now() + GUEST_SESSION_MAX_AGE_MS).toISOString(),
  });

  if (sandboxError) {
    return {
      ok: false,
      error: `Failed to create a fresh guest sandbox: ${sandboxError.message}`,
    };
  }

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: userId,
  });

  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    return {
      ok: false,
      error: cloneError?.message ?? "Failed to reset the guest classroom.",
    };
  }

  return { ok: true, classId, sandboxId };
}
