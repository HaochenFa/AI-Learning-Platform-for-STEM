import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type CleanupCandidate = {
  id: string;
  user_id: string;
  status: "active" | "expired" | "discarded";
  active_ai_requests: number | null;
  created_at: string | null;
  expires_at: string | null;
  last_seen_at: string | null;
};

type GuestMaterialRow = {
  storage_path: string | null;
};

const MATERIALS_BUCKET = "materials";
const DEFAULT_BATCH_SIZE = Number(Deno.env.get("GUEST_SANDBOX_CLEANUP_BATCH") ?? "25");
const MAX_BATCH_SIZE = 100;
const SEED_STORAGE_PREFIX = "guest-seed/";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = Deno.env.get("GUEST_SANDBOX_CLEANUP_TOKEN");
  if (token) {
    const provided = getBearerToken(req.headers.get("authorization"));
    if (provided !== token) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const supabase = createServiceSupabaseClient();
  const batchSize = await resolveBatchSize(req);
  const candidates = await listCleanupCandidates(supabase, batchSize);

  let cleaned = 0;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      await cleanupSandbox(supabase, candidate);
      cleaned += 1;
    } catch (error) {
      errors.push(`${candidate.id}: ${error instanceof Error ? error.message : "Unknown cleanup failure."}`);
    }
  }

  return json(
    {
      ok: true,
      requested_batch_size: batchSize,
      processed: candidates.length,
      cleaned,
      failed: errors.length,
      errors,
    },
    200,
  );
});

function createServiceSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY");

  if (!url || !secretKey) {
    throw new Error("Missing Supabase edge environment variables.");
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveBatchSize(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { batchSize?: number };
    if (typeof body.batchSize === "number" && Number.isFinite(body.batchSize)) {
      return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(body.batchSize)));
    }
  } catch {
    // Ignore malformed JSON and use defaults.
  }

  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(DEFAULT_BATCH_SIZE || 25)));
}

async function listCleanupCandidates(supabase: SupabaseClient, batchSize: number) {
  const expiryCutoff = new Date().toISOString();
  const inactivityCutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("guest_sandboxes")
    .select("id,user_id,status,active_ai_requests,created_at,expires_at,last_seen_at")
    .or(
      [
        "status.in.(expired,discarded)",
        `and(status.eq.active,expires_at.lte.${expiryCutoff})`,
        `and(status.eq.active,last_seen_at.lte.${inactivityCutoff})`,
      ].join(","),
    )
    .order("expires_at", { ascending: true, nullsFirst: true })
    .order("last_seen_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CleanupCandidate[]).filter(
    (candidate) => Boolean(candidate.id) && Boolean(candidate.user_id),
  );
}

async function cleanupSandbox(supabase: SupabaseClient, candidate: CleanupCandidate) {
  const storagePaths = await listGuestMaterialPaths(supabase, candidate.id);
  if (storagePaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(MATERIALS_BUCKET).remove(storagePaths);
    if (removeError) {
      throw new Error(`storage cleanup failed: ${removeError.message}`);
    }
  }

  const { error: classDeleteError } = await supabase.from("classes").delete().eq("sandbox_id", candidate.id);
  if (classDeleteError) {
    throw new Error(`class cleanup failed: ${classDeleteError.message}`);
  }

  const { error: quotaReleaseError } = await supabase.rpc("release_guest_sandbox_quota", {
    p_sandbox_id: candidate.id,
  });
  if (quotaReleaseError) {
    throw new Error(`quota release failed: ${quotaReleaseError.message}`);
  }

  // Decrement active_sessions for sandboxes that were never explicitly discarded.
  // Discarded sandboxes already had their slot decremented by discard_guest_sandbox().
  if (candidate.status !== "discarded") {
    const { error: sessionSlotError } = await supabase.rpc("release_guest_session_slot_service");
    if (sessionSlotError) {
      throw new Error(`session slot release failed: ${sessionSlotError.message}`);
    }
  }

  const { error: userDeleteError } = await supabase.auth.admin.deleteUser(candidate.user_id);
  if (userDeleteError && !isIgnorableDeleteUserError(userDeleteError)) {
    throw new Error(`anonymous user cleanup failed: ${userDeleteError.message}`);
  }

  const { error: sandboxDeleteError } = await supabase
    .from("guest_sandboxes")
    .delete()
    .eq("id", candidate.id)
    .in("status", ["active", "expired", "discarded"]);

  if (sandboxDeleteError) {
    throw new Error(`sandbox row cleanup failed: ${sandboxDeleteError.message}`);
  }
}

async function listGuestMaterialPaths(supabase: SupabaseClient, sandboxId: string) {
  const { data, error } = await supabase
    .from("materials")
    .select("storage_path")
    .eq("sandbox_id", sandboxId);

  if (error) {
    throw new Error(`material lookup failed: ${error.message}`);
  }

  return Array.from(
    new Set(
      ((data ?? []) as GuestMaterialRow[])
        .map((row) => row.storage_path)
        .filter((path): path is string => typeof path === "string" && isGuestMutableStoragePath(path, sandboxId)),
    ),
  );
}

function isGuestMutableStoragePath(path: string, sandboxId: string) {
  if (path.startsWith(SEED_STORAGE_PREFIX)) {
    return false;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  return (
    segments.length >= 5 &&
    segments[0] === "classes" &&
    segments[2] === "sandboxes" &&
    segments[3] === sandboxId
  );
}

function isIgnorableDeleteUserError(error: { message?: string; status?: number }) {
  const message = error.message?.toLowerCase() ?? "";
  return error.status === 404 || message.includes("user not found");
}

function getBearerToken(header: string | null) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
