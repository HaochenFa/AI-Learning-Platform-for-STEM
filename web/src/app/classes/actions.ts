"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { generateJoinCode } from "@/lib/join-code";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_MATERIAL_BYTES,
  detectMaterialKind,
  sanitizeFilename,
} from "@/lib/materials/extract-text";
import {
  assertGuestSafeSignedUrl,
  buildGuestStoragePath,
} from "@/lib/guest/storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireGuestOrVerifiedUser, requireVerifiedUser } from "@/lib/auth/session";

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

function requireAccessTokenOrRedirect(path: string, accessToken: string | null): string {
  if (!accessToken) {
    redirectWithError(path, "Session token is missing. Please sign in again.");
    throw new Error("unreachable");
  }
  return accessToken;
}

const MAX_JOIN_CODE_ATTEMPTS = 5;
const MATERIALS_BUCKET = "materials";

type PythonClassApiError = Error & {
  code?: string;
};

type PythonMaterialDispatchError = Error & {
  safeToRollbackMaterial?: boolean;
};

function resolvePythonBackendTimeoutMs() {
  const parsed = Number(process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS ?? "15000");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }
  return Math.floor(parsed);
}

function createPythonMaterialDispatchError(message: string, safeToRollbackMaterial: boolean) {
  const error = new Error(message) as PythonMaterialDispatchError;
  error.safeToRollbackMaterial = safeToRollbackMaterial;
  return error;
}

function canRollbackMaterialAfterPythonDispatchFailure(error: unknown) {
  return (
    error instanceof Error &&
    (error as PythonMaterialDispatchError).safeToRollbackMaterial === true
  );
}

function isDeterministicPythonDispatchTransportError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const causeCode =
    typeof (error as { cause?: { code?: unknown } }).cause?.code === "string"
      ? (error as { cause?: { code?: string } }).cause?.code
      : null;
  if (
    causeCode === "ENOTFOUND" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "EHOSTUNREACH" ||
    causeCode === "ENETUNREACH"
  ) {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("invalid url") || message.includes("failed to parse url");
}

async function dispatchMaterialJobViaPythonBackend(input: {
  classId: string;
  materialId: string;
}) {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw createPythonMaterialDispatchError("PYTHON_BACKEND_URL is not configured.", true);
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
      data?: { enqueued?: boolean };
      error?: { message?: string };
    } | null = null;
    try {
      payload = (await response.json()) as {
        ok?: boolean;
        data?: { enqueued?: boolean };
        error?: { message?: string };
      };
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const safeToRollbackMaterial =
        payload?.data?.enqueued === false || (response.status >= 400 && response.status < 500);
      throw createPythonMaterialDispatchError(
        payload?.error?.message ??
          `Python backend material dispatch failed with status ${response.status}.`,
        safeToRollbackMaterial,
      );
    }
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      throw createPythonMaterialDispatchError(
        `Python backend material dispatch timed out after ${timeoutMs}ms.`,
        false,
      );
    }
    if (error instanceof Error && "safeToRollbackMaterial" in error) {
      throw error;
    }
    throw createPythonMaterialDispatchError(
      error instanceof Error ? error.message : "Python backend material dispatch failed.",
      isDeterministicPythonDispatchTransportError(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function createClassViaPythonBackend(input: {
  userId: string;
  accessToken: string;
  title: string;
  description?: string | null;
  subject?: string | null;
  level?: string | null;
  joinCode: string;
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
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/classes/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        user_id: input.userId,
        title: input.title,
        description: input.description ?? null,
        subject: input.subject ?? null,
        level: input.level ?? null,
        join_code: input.joinCode,
      }),
      signal: controller.signal,
    });

    const payload = (await safePythonClassJson(response)) as {
      ok?: boolean;
      data?: { class_id?: string };
      error?: { message?: string; code?: string };
    } | null;

    if (!response.ok || !payload?.ok || !payload.data?.class_id) {
      const error = new Error(
        payload?.error?.message ?? `Python backend class create failed with status ${response.status}.`,
      ) as PythonClassApiError;
      error.code = payload?.error?.code;
      throw error;
    }

    return payload.data.class_id;
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      const timeoutError = new Error(
        `Python backend class create timed out after ${timeoutMs}ms.`,
      ) as PythonClassApiError;
      timeoutError.code = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function joinClassViaPythonBackend(input: { userId: string; accessToken: string; joinCode: string }) {
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
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/classes/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        user_id: input.userId,
        join_code: input.joinCode,
      }),
      signal: controller.signal,
    });

    const payload = (await safePythonClassJson(response)) as {
      ok?: boolean;
      data?: { class_id?: string };
      error?: { message?: string; code?: string };
    } | null;

    if (!response.ok || !payload?.ok || !payload.data?.class_id) {
      const error = new Error(
        payload?.error?.message ?? `Python backend class join failed with status ${response.status}.`,
      ) as PythonClassApiError;
      error.code = payload?.error?.code;
      throw error;
    }

    return payload.data.class_id;
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      const timeoutError = new Error(
        `Python backend class join timed out after ${timeoutMs}ms.`,
      ) as PythonClassApiError;
      timeoutError.code = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function safePythonClassJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
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

  const { user, accessToken } = await requireVerifiedUser({ accountType: "teacher" });

  let newClassId: string | null = null;

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    try {
      const sessionAccessToken = requireAccessTokenOrRedirect("/classes/new", accessToken);
      newClassId = await createClassViaPythonBackend({
        userId: user.id,
        accessToken: sessionAccessToken,
        title,
        description: description || null,
        subject: subject || null,
        level: level || null,
        joinCode,
      });
      break;
    } catch (error) {
      if (isRedirectError(error)) {
        throw error;
      }
      const pythonError = error as PythonClassApiError;
      if (pythonError.code === "join_code_conflict") {
        continue;
      }
      redirectWithError("/classes/new", pythonError.message || "Failed to create class.");
    }
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

  const { user, accessToken } = await requireVerifiedUser({ accountType: "student" });

  try {
    const sessionAccessToken = requireAccessTokenOrRedirect("/join", accessToken);
    const classId = await joinClassViaPythonBackend({
      userId: user.id,
      accessToken: sessionAccessToken,
      joinCode,
    });
    redirect(`/classes/${classId}`);
    return;
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    const pythonError = error as PythonClassApiError;
    if (pythonError.code === "class_not_found") {
      redirectWithError("/join", "Invalid join code");
      return;
    }
    redirectWithError("/join", pythonError.message || "Unable to join class.");
    return;
  }
}

export type UploadMaterialMutationResult =
  | {
      ok: true;
      uploadNotice: "processing" | "failed" | "ready";
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

  const { supabase, user, isGuest, sandboxId } = await requireGuestOrVerifiedUser({
    accountType: "teacher",
  });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    return { ok: false, error: access.reason };
  }

  const materialId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath =
    isGuest && sandboxId
      ? buildGuestStoragePath(classId, sandboxId, safeName)
      : `classes/${classId}/${materialId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const baseMetadata = {
    original_name: file.name,
    kind,
    warnings: [] as string[],
    extraction_stats: null,
    page_count: null,
  };
  const processingStatus = isGuest ? "ready" : "processing";
  const storageClient = isGuest ? createAdminSupabaseClient().storage : supabase.storage;

  const { error: uploadError } = await storageClient
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
    await storageClient.from(MATERIALS_BUCKET).remove([storagePath]);
    return { ok: false, error: insertError?.message ?? "Failed to save material record." };
  }

  let jobFailed = false;
  if (processingStatus === "processing") {
    let jobError: { message: string } | null = null;
    let shouldRollbackMaterialOnJobFailure = true;

    try {
      await dispatchMaterialJobViaPythonBackend({
        classId,
        materialId: materialRow.id,
      });
    } catch (error) {
      // Only keep the material when dispatch failure is ambiguous (for
      // example, timeout/5xx after potential enqueue). Deterministic
      // pre-enqueue failures should roll back the upload.
      shouldRollbackMaterialOnJobFailure = canRollbackMaterialAfterPythonDispatchFailure(error);
      jobError = { message: error instanceof Error ? error.message : "Python dispatch failed." };
    }

    if (jobError) {
      jobFailed = true;
      if (shouldRollbackMaterialOnJobFailure) {
        await supabase.from("materials").delete().eq("id", materialRow.id);
        await storageClient.from(MATERIALS_BUCKET).remove([storagePath]);
      }
      return { ok: false, error: `Failed to queue material processing: ${jobError.message}` };
    }
  }

  return { ok: true, uploadNotice: jobFailed ? "failed" : processingStatus };
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

export type MaterialSignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function getMaterialSignedUrl(
  classId: string,
  materialId: string,
): Promise<MaterialSignedUrlResult> {
  const { supabase, user, isGuest, sandboxId } = await requireGuestOrVerifiedUser({
    accountType: "teacher",
  });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    return { ok: false, error: access.reason };
  }

  const { data: material, error: fetchError } = await supabase
    .from("materials")
    .select("id, storage_path")
    .eq("id", materialId)
    .eq("class_id", classId)
    .single();

  if (fetchError || !material) {
    return { ok: false, error: "Material not found." };
  }

  if (isGuest && sandboxId) {
    assertGuestSafeSignedUrl(material.storage_path, sandboxId);
  }

  const storageClient = isGuest ? createAdminSupabaseClient().storage : supabase.storage;
  const { data, error: signedError } = await storageClient
    .from(MATERIALS_BUCKET)
    .createSignedUrl(material.storage_path, 300);

  if (signedError || !data?.signedUrl) {
    return { ok: false, error: signedError?.message ?? "Failed to generate download link." };
  }

  return { ok: true, url: data.signedUrl };
}

export type DeleteMaterialResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteMaterial(
  classId: string,
  materialId: string,
): Promise<DeleteMaterialResult> {
  const { supabase, user, isGuest, sandboxId } = await requireGuestOrVerifiedUser({
    accountType: "teacher",
  });

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    return { ok: false, error: access.reason };
  }

  const { data: material, error: fetchError } = await supabase
    .from("materials")
    .select("id, storage_path, status")
    .eq("id", materialId)
    .eq("class_id", classId)
    .single();

  if (fetchError || !material) {
    return { ok: false, error: "Material not found." };
  }

  if (material.status === "processing") {
    return { ok: false, error: "Cannot delete a material while it is processing." };
  }

  // Delete storage first — if this fails, the DB row is preserved and user can retry.
  // Reversing the order would leave orphaned storage objects invisible to the UI.
  if (isGuest && sandboxId) {
    assertGuestSafeSignedUrl(material.storage_path, sandboxId);
  }

  const storageClient = isGuest ? createAdminSupabaseClient().storage : supabase.storage;
  const { error: storageError } = await storageClient
    .from(MATERIALS_BUCKET)
    .remove([material.storage_path]);

  if (storageError) {
    return { ok: false, error: storageError.message };
  }

  const { error: deleteError } = await supabase
    .from("materials")
    .delete()
    .eq("id", materialId);

  if (deleteError) {
    return { ok: false, error: deleteError.message };
  }

  revalidatePath(`/classes/${classId}`);
  return { ok: true };
}
