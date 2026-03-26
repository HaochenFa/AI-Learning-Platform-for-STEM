"use server";

import { GUEST_SESSION_MAX_AGE_MS } from "@/lib/guest/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type GuestSandboxResult =
  | {
      ok: true;
      classId: string;
      sandboxId: string;
    }
  | {
      ok: false;
      error: string;
    };

type ActiveSandboxRow = {
  id: string;
  class_id: string | null;
  status: "active" | "expired" | "discarded";
  guest_role: "teacher" | "student";
};

function isMaybeSingleNoRowsError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "PGRST116";
}

export async function provisionGuestSandbox(): Promise<GuestSandboxResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { session: existingSession },
  } = await supabase.auth.getSession();

  if (existingSession?.user) {
    const { data: existingSandbox, error: existingSandboxError } = await supabase
      .from("guest_sandboxes")
      .select("id,class_id,status,guest_role")
      .eq("user_id", existingSession.user.id)
      .eq("status", "active")
      .maybeSingle<ActiveSandboxRow>();

    if (existingSandboxError && !isMaybeSingleNoRowsError(existingSandboxError)) {
      return {
        ok: false,
        error: "We couldn't verify your current guest session. Please try again.",
      };
    }

    if (existingSandbox?.class_id) {
      return {
        ok: true,
        classId: existingSandbox.class_id,
        sandboxId: existingSandbox.id,
      };
    }
  }

  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError || !authData.user) {
    return {
      ok: false,
      error: authError?.message ?? "Failed to create an anonymous guest session.",
    };
  }

  const sandboxId = crypto.randomUUID();
  const { error: sandboxError } = await supabase.from("guest_sandboxes").insert({
    id: sandboxId,
    user_id: authData.user.id,
    guest_role: "teacher",
    status: "active",
    expires_at: new Date(Date.now() + GUEST_SESSION_MAX_AGE_MS).toISOString(),
  });

  if (sandboxError) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: `Failed to create a guest sandbox: ${sandboxError.message}`,
    };
  }

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: authData.user.id,
  });

  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    await supabase.auth.signOut();
    return {
      ok: false,
      error: cloneError?.message ?? "Failed to provision the guest classroom.",
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
