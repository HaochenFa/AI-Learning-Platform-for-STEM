"use client";

import { useFormStatus } from "react-dom";
import { useState } from "react";
import FileUploadZone, { type UploadFile } from "@/app/components/FileUploadZone";
import { MAX_MATERIAL_BYTES } from "@/lib/materials/constants";

type MaterialUploadFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

function SubmitButton({ fileCount }: { fileCount: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || fileCount === 0}
      className="btn-primary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Uploading..." : `Upload ${fileCount > 1 ? `${fileCount} files` : "material"}`}
    </button>
  );
}

function UploadProgress() {
  const { pending } = useFormStatus();

  if (!pending) {
    return null;
  }

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-3 text-xs text-ui-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-default border-t-slate-600" />
        Uploading your materials. Large files can take a minute.
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--text-muted)]" />
      </div>
    </div>
  );
}

export default function MaterialUploadForm({ action }: MaterialUploadFormProps) {
  const maxSizeMb = Math.round(MAX_MATERIAL_BYTES / (1024 * 1024));
  const [files, setFiles] = useState<UploadFile[]>([]);

  const handleSubmit = async (formData: FormData) => {
    const pendingFiles = files.filter((f) => f.status !== "error");
    if (pendingFiles.length === 0) return;

    for (let i = 0; i < pendingFiles.length; i++) {
      const uploadFile = pendingFiles[i];
      formData.append("file", uploadFile.file);
      if (pendingFiles.length > 1) {
        const title = uploadFile.file.name.replace(/\.[^/.]+$/, "");
        formData.append("title", title);
      }
    }

    if (pendingFiles.length === 1 && !formData.get("title")) {
      const title = pendingFiles[0].file.name.replace(/\.[^/.]+$/, "");
      formData.set("title", title);
    }

    setFiles((prev) =>
      prev.map((f) => (f.status !== "error" ? { ...f, status: "uploading" as const } : f)),
    );

    try {
      await action(formData);
      setFiles([]);
    } catch {
      setFiles((prev) =>
        prev.map((f) =>
          f.status === "uploading"
            ? { ...f, status: "error" as const, error: "Upload failed. Please try again." }
            : f,
        ),
      );
    }
  };

  return (
    <form className="space-y-4" action={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-ui-subtle" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          placeholder="Lecture 3: Limits and Continuity"
          disabled={files.length > 1}
          className="w-full rounded-xl border border-default bg-white px-4 py-2 text-sm text-ui-primary outline-none transition focus-ring-warm disabled:bg-[var(--surface-muted)] disabled:text-ui-muted"
        />
        {files.length > 1 && (
          <p className="text-xs text-ui-muted">
            Multiple files detected. Each file will be uploaded with its filename as title.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-ui-subtle">
          Files
        </label>
        <FileUploadZone
          accept=".pdf,.docx,.pptx"
          maxSizeMB={maxSizeMb}
          maxFiles={10}
          onFilesChange={setFiles}
        />
      </div>
      <SubmitButton fileCount={files.filter((f) => f.status !== "error").length} />
      <UploadProgress />
    </form>
  );
}
