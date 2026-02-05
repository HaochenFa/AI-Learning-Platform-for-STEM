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

  const { error: enrollmentError } = await supabase.from("enrollments").insert({
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

  const { data: classId, error } = await supabase.rpc("join_class_by_code", {
    code: joinCode,
  });

  if (error || !classId) {
    redirectWithError("/join", "Invalid join code");
    return;
  }

  redirect(`/classes/${classId}`);
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
      `File exceeds ${Math.round(MAX_MATERIAL_BYTES / (1024 * 1024))}MB limit`,
    );
  }

  const kind = detectMaterialKind(file);
  if (!kind) {
    redirectWithError(
      `/classes/${classId}`,
      `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
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

  const materialId = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storagePath = `classes/${classId}/${materialId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const extraction = await extractTextFromBuffer(buffer, kind);
  const extractedText = extraction.text || null;
  const processingStatus = extraction.status === "failed" ? "failed" : "processing";
  const baseMetadata = {
    original_name: file.name,
    kind,
    warnings: extraction.warnings,
    extraction_stats: extraction.stats,
    page_count: extraction.pageCount ?? null,
  };

  const { error: uploadError } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    redirectWithError(`/classes/${classId}`, uploadError.message);
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
      extracted_text: extractedText,
      metadata: baseMetadata,
    })
    .select("id")
    .single();

  if (insertError || !materialRow) {
    await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath]);
    redirectWithError(`/classes/${classId}`, insertError.message);
    return;
  }

  let jobFailed = false;
  if (processingStatus === "processing") {
    const { error: jobError } = await supabase.from("material_processing_jobs").insert({
      material_id: materialRow.id,
      class_id: classId,
      status: "pending",
      stage: "queued",
    });

    if (jobError) {
      jobFailed = true;
      const { error: statusError } = await supabase
        .from("materials")
        .update({
          status: "failed",
          metadata: {
            ...baseMetadata,
            warnings: [...baseMetadata.warnings, `Job creation failed: ${jobError.message}`],
          },
        })
        .eq("id", materialRow.id);

      if (statusError) {
        await supabase.from("materials").delete().eq("id", materialRow.id);
        await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath]);
      }
    }
  }

  const uploadNotice =
    processingStatus === "failed" || jobFailed ? "uploaded=failed" : "uploaded=processing";

  redirect(`/classes/${classId}?${uploadNotice}`);
}
