"use server";

import { GUEST_SESSION_MAX_AGE_MS } from "@/lib/guest/config";
import {
  getGuestSessionExpiredMessage,
  isGuestSandboxExpired,
} from "@/lib/guest/session-expiry";
import { type GuestProvisionFailureCode } from "@/lib/guest/errors";
import { isGuestMutableStoragePath } from "@/lib/guest/storage";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Discriminated union returned by all sandbox provisioning functions.
 *
 * On success, `classId` is the UUID of the guest's assigned class and
 * `sandboxId` is the guest_sandboxes row id (used for subsequent touch /
 * discard calls). On failure, `code` is a machine-readable failure code and
 * `reason` narrows which branch of the state machine produced the error.
 */
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

/** Returns true when a PostgREST PGRST116 "no rows" error is received.
 *  maybeSingle() resolves to null in that case, but the error object is
 *  still populated — we treat it as a non-error so callers don't need to
 *  special-case it everywhere. */
function isMaybeSingleNoRowsError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "PGRST116";
}

/**
 * Detects whether a Supabase user is an anonymous (guest) user.
 *
 * Supabase sets `is_anonymous: true` on the user object for anonymous sign-ins.
 * As a belt-and-suspenders check we also test `app_metadata.provider` because
 * older SDK versions may not expose `is_anonymous` directly.
 *
 * @param user  The user object from a Supabase session, or null/undefined if no session exists.
 * @returns     `true` if the user was created via `signInAnonymously()`.
 */
function isAnonymousUser(user: {
  is_anonymous?: boolean;
  app_metadata?: { provider?: string | null } | null;
} | null | undefined) {
  return user?.is_anonymous === true || user?.app_metadata?.provider === "anonymous";
}

/**
 * Marks a sandbox row as expired in place.
 *
 * The `.eq("status", "active")` guard prevents double-expiry races where two
 * concurrent requests both read an active sandbox and attempt to expire it.
 */
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

  // Decrement the global active-session counter so the returning user's new
  // session slot can be acquired without double-counting the expired row.
  // The cleanup worker would also do this, but only after cron runs — without
  // this call the returning user inflates active_sessions until cleanup runs.
  await releaseGuestSessionSlot();
}

/**
 * Deletes all Supabase Storage objects associated with a guest sandbox.
 *
 * Storage must be cleaned up *before* the DB row is discarded because the
 * materials rows (which record `storage_path`) are cascade-deleted along with
 * the sandbox.  Cleaning storage after would lose the path references needed
 * to identify the files.
 *
 * Only paths that pass `isGuestMutableStoragePath` (i.e., belong to this
 * sandbox) are removed, preventing accidental deletion of shared assets.
 *
 * @param sandboxId  The guest_sandboxes.id whose storage objects should be removed.
 * @returns          `{ ok: true }` on success, `{ ok: false, error }` if the
 *                   materials query or storage removal fails.
 */
async function removeGuestSandboxStorageObjects(
  sandboxId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Admin client is required because storage RLS restricts deletion to the
  // owning user, but we may be cleaning up after the session has already ended.
  const adminSupabase = createAdminSupabaseClient();
  const { data: materials, error: materialsError } = await adminSupabase
    .from("materials")
    .select("storage_path")
    .eq("sandbox_id", sandboxId);

  if (materialsError) {
    return { ok: false, error: materialsError.message };
  }

  const materialRows = (materials ?? []) as GuestMaterialStorageRow[];
  // De-duplicate paths and filter out any path that does not belong to this
  // sandbox to guard against misconfigured storage_path values in the DB.
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

/**
 * Releases a previously acquired global session quota slot.
 *
 * Called in the provision failure path when `acquire_guest_session_service`
 * succeeded but a later step (anonymous auth or sandbox insert/clone) failed.
 * Prevents leaking an active-session slot count if provisioning rolls back.
 */
async function releaseGuestSessionSlot(): Promise<void> {
  const adminSupabase = createAdminSupabaseClient();
  await adminSupabase.rpc("release_guest_session_slot_service", {});
}

/**
 * Provisions a new guest sandbox for the current server session.
 *
 * Thin public wrapper around `provisionGuestSandboxWithOptions` for callers
 * that don't need to pass an IP address (e.g., internal server actions that
 * already enforce their own rate limiting upstream).
 *
 * @returns  A `GuestSandboxResult` describing the provisioned sandbox or the
 *           failure code if provisioning could not complete.
 */
export async function provisionGuestSandbox(): Promise<GuestSandboxResult> {
  return provisionGuestSandboxWithOptions();
}

/**
 * Core guest sandbox provisioning state machine.
 *
 * The function handles seven distinct situations a caller may arrive in:
 *
 * 1. **No existing session** — Check the global session quota via
 *    `acquire_guest_session_service`, create an anonymous Supabase user,
 *    insert a sandbox row, and run `clone_guest_sandbox` to stamp a copy of
 *    the template class.
 *
 * 2. **Existing anonymous user with an active, valid sandbox that already has
 *    a `class_id`** — Return immediately; nothing to do.
 *
 * 3. **Existing anonymous user with an active, valid sandbox but no
 *    `class_id` yet** — Call `clone_guest_sandbox` to attach a class to the
 *    existing sandbox without creating a new user or sandbox row.
 *
 * 4. **Existing anonymous user whose sandbox has expired** — Expire the sandbox
 *    row, sign out the anonymous user (cleaning up the Supabase Auth record),
 *    reset `guestUserId` to null, and fall through to provision a fresh sandbox.
 *
 * 5. **Existing non-anonymous (real) user with an active, valid sandbox** —
 *    Block: real users cannot enter guest mode without signing out first.
 *
 * 6. **Existing non-anonymous user whose sandbox has expired** — Block: surface
 *    the expiry message but do *not* sign them out (their real session is valid).
 *
 * 7. **Existing non-anonymous user with no sandbox** — Block with conflict error.
 *
 * `shouldSignOutOnFailure` tracks whether *this call* created the anonymous
 * Supabase user.  If any subsequent step (sandbox insert or clone) fails we
 * must undo the anonymous sign-in to avoid orphaned Auth records.  We cannot
 * simply call `signOut()` unconditionally on failure because we should NOT
 * sign out a pre-existing anonymous user whose session was only partially
 * usable.
 *
 * @returns  `GuestSandboxResult` with the provisioned `classId` and `sandboxId`.
 */
export async function provisionGuestSandboxWithOptions(): Promise<GuestSandboxResult> {
  const supabase = await createServerSupabaseClient();

  // --- Inspect existing session ---

  const {
    data: { session: existingSession },
  } = await supabase.auth.getSession();
  const existingUser = existingSession?.user ?? null;
  const existingUserIsAnonymous = isAnonymousUser(existingUser);
  // Carry the anonymous user id forward so we can skip a new signInAnonymously()
  // call if a valid anonymous session already exists.
  let guestUserId = existingUserIsAnonymous ? existingUser?.id ?? null : null;
  // Set to true only when *this invocation* created the anonymous Auth user,
  // so we know to undo it if a later step fails (prevents orphaned Auth rows).
  let shouldSignOutOnFailure = false;

  if (existingUser) {
    // --- Check for an existing sandbox on the current user ---

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

    // --- Branch: expired sandbox ---

    if (existingSandbox && isGuestSandboxExpired(existingSandbox)) {
      await expireGuestSandbox(supabase, existingSandbox.id);

      if (!existingUserIsAnonymous) {
        // A real (email/password) user's expired sandbox: surface the error
        // message but do not touch their authentication session.
        return {
          ok: false,
          code: "guest-session-conflict",
          error: getGuestSessionExpiredMessage(),
          reason: "expired-non-anonymous-session",
        };
      }

      // For an anonymous user the Auth record is only useful while the sandbox
      // is alive.  Sign them out so a fresh anonymous user can be created below.
      await supabase.auth.signOut();
      guestUserId = null;
    }

    // --- Branch: active sandbox already has a class assigned ---

    if (existingSandbox?.class_id && !isGuestSandboxExpired(existingSandbox)) {
      return {
        ok: true,
        classId: existingSandbox.class_id,
        sandboxId: existingSandbox.id,
      };
    }

    // --- Branch: real (non-anonymous) user with no usable sandbox ---

    if (!existingUserIsAnonymous) {
      return {
        ok: false,
        code: "guest-session-conflict",
        error: "Please sign out before starting a guest session.",
        reason: "existing-authenticated-session",
      };
    }

    // --- Branch: anonymous user with an active sandbox but no class yet ---
    // Call clone_guest_sandbox to attach a template class to the existing
    // sandbox row rather than creating a new user + sandbox from scratch.

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

  // --- Global session quota check (new session path only) ---
  // Atomically checks active-session cap (60) and hourly creation rate (20/h).
  // If acquired, the slot must be released if a later step fails (shouldReleaseSessionQuota tracks this).

  let shouldReleaseSessionQuota = false;
  const adminSupabase = createAdminSupabaseClient();
  const { data: quotaResult, error: quotaError } = await adminSupabase.rpc(
    "acquire_guest_session_service",
    {},
  );

  if (quotaError) {
    return {
      ok: false,
      code: "guest-unavailable",
      error: "guest-unavailable",
      reason: "session-quota-check",
    };
  }

  const quota = quotaResult as { ok: boolean; reason?: string } | null;
  if (!quota?.ok) {
    if (quota?.reason === "cap_creation") {
      return {
        ok: false,
        code: "too-many-new-sessions",
        error: "too-many-new-sessions",
        reason: "creation-rate-cap",
      };
    }
    return {
      ok: false,
      code: "too-many-active-sessions",
      error: "too-many-active-sessions",
      reason: "active-session-cap",
    };
  }
  shouldReleaseSessionQuota = true;

  // --- Create anonymous Auth user if not already available ---

  if (!guestUserId) {
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !authData.user) {
      if (shouldReleaseSessionQuota) {
        await releaseGuestSessionSlot();
      }
      return {
        ok: false,
        code: "guest-auth-unavailable",
        error: authError?.message ?? "Failed to create an anonymous guest session.",
        reason: "anonymous-auth",
      };
    }

    guestUserId = authData.user.id;
    // Mark that we own this Auth record so failure handling can clean it up.
    shouldSignOutOnFailure = true;
  }

  if (!guestUserId) {
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
    }
    return {
      ok: false,
      code: "guest-auth-unavailable",
      error: "Failed to create an anonymous guest session.",
      reason: "anonymous-auth-missing-user",
    };
  }

  // --- Insert sandbox row ---

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
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: `Failed to create a guest sandbox: ${sandboxError.message}`,
      reason: "sandbox-insert",
    };
  }

  // --- Clone template class into the new sandbox ---
  // `clone_guest_sandbox` is a Postgres function that copies the template class,
  // its blueprint, materials, and enrollments into a fresh class row scoped to
  // this sandbox.  It returns the new class_id on success.

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: guestUserId,
  });

  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    // discard_guest_sandbox RPC will decrement active_sessions; but since we
    // set status='discarded' directly (not via RPC), release the slot manually.
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
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

/**
 * Switches the guest role (teacher ↔ student) for an active sandbox.
 *
 * The role controls which subset of the guest class UI the user sees.
 * `last_seen_at` is bumped so the inactivity expiry clock resets.
 *
 * @param sandboxId  The active guest_sandboxes row to update.
 * @param newRole    Target role ("teacher" or "student").
 * @returns          `{ ok: true }` on success, `{ ok: false, error }` on DB failure.
 */
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

/**
 * Refreshes the `last_seen_at` timestamp on an active sandbox.
 *
 * Called periodically by the client to keep the inactivity window from
 * closing mid-session.  The `.eq("status", "active")` guard is a no-op
 * (safe) if the sandbox has already expired.
 *
 * @param sandboxId  The active guest_sandboxes row to touch.
 * @returns          `{ ok: true }` on success, `{ ok: false, error }` on DB failure.
 */
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

/**
 * Fully tears down a guest sandbox: storage objects first, then the DB row.
 *
 * The two-step order is intentional: the `materials` rows that record
 * `storage_path` values are deleted (via cascade) when the sandbox is
 * discarded, so storage cleanup must happen *before* the RPC call.
 * `discard_guest_sandbox` is a Postgres function that marks the sandbox as
 * "discarded" and cascade-deletes all associated class data.
 *
 * @param sandboxId  The guest_sandboxes row to discard.
 * @returns          `{ ok: true }` on full success, `{ ok: false, error }` if
 *                   either storage cleanup or the DB discard fails.
 */
export async function discardGuestSandbox(
  sandboxId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();

  // Storage must be cleaned before the DB row is discarded — see JSDoc above.
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

/**
 * Discards the current active sandbox for a user and provisions a fresh one.
 *
 * Used by the "Reset Demo" flow that lets a guest start the walkthrough over.
 * Unlike `provisionGuestSandboxWithOptions` this function receives an explicit
 * `userId` (already verified by the caller) and does not perform rate-limit or
 * session checks.
 *
 * @param userId  The Supabase Auth user id of the guest requesting a reset.
 * @returns       A `GuestSandboxResult` with the new sandbox's details.
 */
export async function resetGuestSandbox(userId: string): Promise<GuestSandboxResult> {
  const supabase = await createServerSupabaseClient();

  // --- Discard existing sandbox, if any ---

  const { data: existingSandbox, error: existingSandboxError } = await supabase
    .from("guest_sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();

  if (existingSandboxError && !isMaybeSingleNoRowsError(existingSandboxError)) {
    return {
      ok: false,
      code: "guest-session-check-failed",
      error: "We couldn't verify your current guest session. Please try again.",
      reason: "existing-session-check",
    };
  }

  // --- Acquire global session quota slot BEFORE discarding the old sandbox ---
  // Checking caps first ensures the guest still has a working demo if the
  // system is at capacity — we never destroy the existing sandbox speculatively.
  // During the brief window between acquire and discard, active_sessions is
  // over-counted by 1; with a 60-session cap this is acceptable.

  const adminSupabase = createAdminSupabaseClient();
  const { data: quotaResult, error: quotaError } = await adminSupabase.rpc(
    "acquire_guest_session_service",
    {},
  );
  if (quotaError) {
    return {
      ok: false,
      code: "guest-unavailable",
      error: "guest-unavailable",
      reason: "session-quota-check",
    };
  }
  const quota = quotaResult as { ok: boolean; reason?: string } | null;
  if (!quota?.ok) {
    return {
      ok: false,
      code: quota?.reason === "cap_creation" ? "too-many-new-sessions" : "too-many-active-sessions",
      error: quota?.reason === "cap_creation" ? "too-many-new-sessions" : "too-many-active-sessions",
      reason: quota?.reason === "cap_creation" ? "creation-rate-cap" : "active-session-cap",
    };
  }

  // --- Discard existing sandbox now that the new slot is secured ---

  if (existingSandbox?.id) {
    const discarded = await discardGuestSandbox(existingSandbox.id);
    if (!discarded.ok) {
      // New slot was acquired but old sandbox could not be discarded — release it.
      await releaseGuestSessionSlot();
      return {
        ok: false,
        code: "guest-sandbox-provision-failed",
        error: discarded.error ?? "Failed to discard the old guest sandbox.",
        reason: "discard-existing-sandbox",
      };
    }
  }

  // --- Insert fresh sandbox row ---

  const sandboxId = crypto.randomUUID();
  const { error: sandboxError } = await supabase.from("guest_sandboxes").insert({
    id: sandboxId,
    user_id: userId,
    guest_role: "teacher",
    status: "active",
    expires_at: new Date(Date.now() + GUEST_SESSION_MAX_AGE_MS).toISOString(),
  });

  if (sandboxError) {
    await releaseGuestSessionSlot();
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: `Failed to create a fresh guest sandbox: ${sandboxError.message}`,
      reason: "sandbox-insert",
    };
  }

  // --- Clone template class into the new sandbox ---

  const { data: classId, error: cloneError } = await supabase.rpc("clone_guest_sandbox", {
    p_sandbox_id: sandboxId,
    p_guest_user_id: userId,
  });

  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    // The slot was acquired above but we set status='discarded' directly (not via
    // discard_guest_sandbox RPC), so the cleanup worker will skip the decrement.
    // Release the slot manually to prevent leaking active_sessions.
    await releaseGuestSessionSlot();
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: cloneError?.message ?? "Failed to reset the guest classroom.",
      reason: "sandbox-clone",
    };
  }

  return { ok: true, classId, sandboxId };
}
