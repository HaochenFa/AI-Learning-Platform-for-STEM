"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_MATERIAL_BYTES,
  detectMaterialKind,
  extractTextFromBuffer,
  sanitizeFilename,
} from "@/lib/materials/extract-text";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

async function requireTeacherAccess(
  classId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
) {
  type AccessResult =
    | { allowed: true }
    | { allowed: false; reason: string };

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

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let newClassId: string | null = null;

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data, error } = await supabase
      .from("classes")
      .insert({
        owner_id: user.id,
        title,
        description,
        subject,
        level,
        join_code: joinCode,
      })
      .select("id")
      .single();

    if (!error && data) {
      newClassId = data.id;
      break;
    }

    if (error?.code !== "23505") {
      redirectWithError("/classes/new", error.message);
    }
  }

  if (!newClassId) {
    redirectWithError("/classes/new", "Unable to generate a join code");
  }

  const { error: enrollmentError } = await supabase
    .from("enrollments")
    .insert({
      class_id: newClassId,
      user_id: user.id,
      role: "teacher",
    });

  if (enrollmentError) {
    redirectWithError("/classes/new", enrollmentError.message);
  }

  redirect(`/classes/${newClassId}`);
}

export async function joinClass(formData: FormData) {
  const joinCode = getFormValue(formData, "join_code").toUpperCase();

  if (!joinCode) {
    redirectWithError("/join", "Join code is required");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    redirectWithError("/join", "Server configuration error");
    return;
  }
  const { data: classRow, error } = await admin
    .from("classes")
    .select("id")
    .eq("join_code", joinCode)
    .single();

  if (error || !classRow) {
    redirectWithError("/join", "Invalid join code");
    return;
  }

  const { error: enrollmentError } = await admin
    .from("enrollments")
    .upsert(
      {
        class_id: classRow.id,
        user_id: user.id,
        role: "student",
      },
      { onConflict: "class_id,user_id", ignoreDuplicates: true }
    );

  if (enrollmentError) {
    redirectWithError("/join", enrollmentError.message);
  }

  redirect(`/classes/${classRow.id}`);
}

export async function uploadMaterial(classId: string, formData: FormData) {
  const title = getFormValue(formData, "title");
  const file = formData.get("file");

  if (!(file instanceof File)) {
    redirectWithError(`/classes/${classId}`, "Material file is required");
    return;
  }

  if (file.size === 0) {
    redirectWithError(`/classes/${classId}`, "Material file is empty");
  }

  if (file.size > MAX_MATERIAL_BYTES) {
    redirectWithError(
      `/classes/${classId}`,
      `File exceeds ${Math.round(MAX_MATERIAL_BYTES / (1024 * 1024))}MB limit`
    );
  }

  const kind = detectMaterialKind(file);
  if (!kind) {
    redirectWithError(
      `/classes/${classId}`,
      `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
    );
    return;
  }

  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    !ALLOWED_MIME_TYPES.includes(file.type)
  ) {
    redirectWithError(`/classes/${classId}`, "Unsupported MIME type");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const access = await requireTeacherAccess(classId, user.id, supabase);
  if (!access.allowed) {
    redirectWithError(`/classes/${classId}`, access.reason);
  }

  const admin = createSupabaseAdminClient();
  const materialId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath = `classes/${classId}/${materialId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const extraction = await extractTextFromBuffer(buffer, kind);
  const extractedText = extraction.text || null;

  const { error: uploadError } = await admin.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    redirectWithError(`/classes/${classId}`, uploadError.message);
  }

  const { error: insertError } = await admin.from("materials").insert({
    id: materialId,
    class_id: classId,
    uploaded_by: user.id,
    title: title || file.name || "Untitled material",
    storage_path: storagePath,
    mime_type: file.type || null,
    size_bytes: file.size,
    status: extraction.status,
    extracted_text: extractedText,
    metadata: {
      original_name: file.name,
      kind,
      warnings: extraction.warnings,
    },
  });

  if (insertError) {
    await admin.storage.from(MATERIALS_BUCKET).remove([storagePath]);
    redirectWithError(`/classes/${classId}`, insertError.message);
  }

  const uploadNotice =
    extraction.status === "needs_vision"
      ? "uploaded=vision"
      : extraction.status === "failed"
        ? "uploaded=failed"
        : "uploaded=1";

  redirect(`/classes/${classId}?${uploadNotice}`);
}
