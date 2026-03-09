"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_MATERIAL_BYTES,
  detectMaterialKind,
  sanitizeFilename,
} from "@/lib/materials/extract-text";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireVerifiedUser } from "@/lib/auth/session";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function redirectWithError(path: string, message: string) {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const MAX_JOIN_CODE_ATTEMPTS = 5;
const MATERIALS_BUCKET = "materials";

function resolveMaterialWorkerBackend() {
  return (process.env.MATERIAL_WORKER_BACKEND ?? "supabase").toLowerCase();
}

function isPythonBackendStrict() {
  const raw = process.env.PYTHON_BACKEND_STRICT;
  if (!raw) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function resolvePythonBackendTimeoutMs() {
  const parsed = Number(process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS ?? "15000");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }
  return Math.floor(parsed);
}

async function dispatchMaterialJobViaPythonBackend(input: {
  classId: string;
  materialId: string;
}) {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw new Error("PYTHON_BACKEND_URL is not configured.");
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const timeoutMs = resolvePythonBackendTimeoutMs();
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/materials/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        class_id: input.classId,
        material_id: input.materialId,
        trigger_worker: true,
      }),
      signal: controller.signal,
    });

    let payload: {
      ok?: boolean;
      error?: { message?: string };
    } | null = null;
    try {
      payload = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.error?.message ??
          `Python backend material dispatch failed with status ${response.status}.`,
      );
    }
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      throw new Error(`Python backend material dispatch timed out after ${timeoutMs}ms.`);
    }
    throw error instanceof Error ? error : new Error("Python backend material dispatch failed.");
  } finally {
    clearTimeout(timer);
  }
}

async function requireTeacherAccess(
  classId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  type AccessResult = { allowed: true } | { allowed: false; reason: string };

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,owner_id")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    return { allowed: false, reason: "Class not found." } satisfies AccessResult;
  }

  if (classRow.owner_id === userId) {
    return { allowed: true } satisfies AccessResult;
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .single();

  if (enrollment?.role === "teacher" || enrollment?.role === "ta") {
    return { allowed: true } satisfies AccessResult;
  }

  return {
    allowed: false,
    reason: "Teacher access required.",
  } satisfies AccessResult;
}

export async function createClass(formData: FormData) {
  const title = getFormValue(formData, "title");
  const description = getFormValue(formData, "description");
  const subject = getFormValue(formData, "subject");
  const level = getFormValue(formData, "level");

  if (!title) {
    redirectWithError("/classes/new", "Class title is required");
  }

  const { supabase } = await requireVerifiedUser({ accountType: "teacher" });

  let newClassId: string | null = null;

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data, error } = await supabase.rpc("create_class", {
      p_title: title,
      p_description: description || null,
      p_subject: subject || null,
      p_level: level || null,
      p_join_code: joinCode,
    });

    if (!error && data) {
      newClassId = data;
      break;
    }

    if (error) {
      if (error.code !== "23505") {
        redirectWithError("/classes/new", error.message);
      }
      continue;
    }

    redirectWithError("/classes/new", "Unexpected response from database");
  }

  if (!newClassId) {
    redirectWithError("/classes/new", "Unable to generate a join code");
  }

  redirect(`/classes/${newClassId}`);
}

export async function joinClass(formData: FormData) {
  const joinCode = getFormValue(formData, "join_code").toUpperCase();

  if (!joinCode) {
    redirectWithError("/join", "Join code is required");
  }

  const { supabase } = await requireVerifiedUser({ accountType: "student" });

  const { data: classId, error } = await supabase.rpc("join_class_by_code", {
    code: joinCode,
  });

  if (error || !classId) {
    redirectWithError("/join", "Invalid join code");
    return;
  }

  redirect(`/classes/${classId}`);
}

export type UploadMaterialMutationResult =
  | {
      ok: true;
      uploadNotice: "processing" | "failed";
    }
  | {
      ok: false;
      error: string;
    };

async function uploadMaterialMutationInternal(
  classId: string,
  formData: FormData,
): Promise<UploadMaterialMutationResult> {
  const title = getFormValue(formData, "title");
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, error: "Material file is required" };
  }

  if (file.size === 0) {
    return { ok: false, error: "Material file is empty" };
  }

  if (file.size > MAX_MATERIAL_BYTES) {
    return {
      ok: false,
      error: `File exceeds ${Math.round(MAX_MATERIAL_BYTES / (1024 * 1024))}MB limit`,
    };
  }

  const kind = detectMaterialKind(file);
  if (!kind) {
    return { ok: false, error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` };
  }

  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    !ALLOWED_MIME_TYPES.includes(file.type)
  ) {
    return { ok: false, error: "Unsupported MIME type" };
  }

  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    return { ok: false, error: access.reason };
  }

  const materialId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath = `classes/${classId}/${materialId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const baseMetadata = {
    original_name: file.name,
    kind,
    warnings: [] as string[],
    extraction_stats: null,
    page_count: null,
  };
  const processingStatus = "processing";

  const { error: uploadError } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data: materialRow, error: insertError } = await supabase
    .from("materials")
    .insert({
      id: materialId,
      class_id: classId,
      uploaded_by: user.id,
      title: title || file.name || "Untitled material",
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      status: processingStatus,
      extracted_text: null,
      metadata: baseMetadata,
    })
    .select("id")
    .single();

  if (insertError || !materialRow) {
    await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath]);
    return { ok: false, error: insertError?.message ?? "Failed to save material record." };
  }

  let jobFailed = false;
  if (processingStatus === "processing") {
    const workerBackend = resolveMaterialWorkerBackend();
    let jobError: { message: string } | null = null;

    if (workerBackend === "python") {
      try {
        await dispatchMaterialJobViaPythonBackend({
          classId,
          materialId: materialRow.id,
        });
      } catch (error) {
        if (isPythonBackendStrict()) {
          jobError = { message: error instanceof Error ? error.message : "Python dispatch failed." };
        } else {
          const fallback = await supabase.rpc("enqueue_material_job", {
            p_material_id: materialRow.id,
            p_class_id: classId,
          });
          jobError = fallback.error ? { message: fallback.error.message } : null;
        }
      }
    } else if (workerBackend === "supabase") {
      const result = await supabase.rpc("enqueue_material_job", {
        p_material_id: materialRow.id,
        p_class_id: classId,
      });
      jobError = result.error ? { message: result.error.message } : null;
    } else {
      const result = await supabase.from("material_processing_jobs").insert({
        material_id: materialRow.id,
        class_id: classId,
        status: "pending",
        stage: "queued",
      });
      jobError = result.error ? { message: result.error.message } : null;
    }

    if (jobError) {
      jobFailed = true;
      await supabase.from("materials").delete().eq("id", materialRow.id);
      await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath]);
      return { ok: false, error: `Failed to queue material processing: ${jobError.message}` };
    }
  }

  return { ok: true, uploadNotice: jobFailed ? "failed" : "processing" };
}

export async function uploadMaterialMutation(classId: string, formData: FormData) {
  return uploadMaterialMutationInternal(classId, formData);
}

export async function uploadMaterial(classId: string, formData: FormData) {
  const result = await uploadMaterialMutationInternal(classId, formData);
  if (!result.ok) {
    redirectWithError(`/classes/${classId}`, result.error);
    return;
  }

  redirect(`/classes/${classId}?uploaded=${result.uploadNotice}`);
}
