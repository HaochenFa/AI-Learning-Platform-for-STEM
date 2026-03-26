"use client";

import { useFormStatus } from "react-dom";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import FileUploadZone, { type UploadFile } from "@/app/components/FileUploadZone";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { MAX_MATERIAL_BYTES } from "@/lib/materials/constants";

type UploadMaterialMutationResult =
  | {
      ok: true;
      uploadNotice: "processing" | "failed" | "ready";
    }
  | {
      ok: false;
      error: string;
    };

type MaterialUploadFormProps = {
  action: (formData: FormData) => Promise<UploadMaterialMutationResult>;
};

function SubmitButton({ fileCount }: { fileCount: number }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || fileCount === 0} className="w-full" variant="warm">
      {pending ? "Uploading..." : `Upload ${fileCount > 1 ? `${fileCount} files` : "material"}`}
    </Button>
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
        <AppIcons.loading className="h-4 w-4 animate-spin" />
        Uploading your materials. Large files can take a minute.
      </div>
      <Progress value={65} />
    </div>
  );
}

export default function MaterialUploadForm({ action }: MaterialUploadFormProps) {
  const maxSizeMb = Math.round(MAX_MATERIAL_BYTES / (1024 * 1024));
  const [files, setFiles] = useState<UploadFile[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  const handleSubmit = async (formData: FormData) => {
    const pendingFiles = files.filter((file) => file.status === "pending");
    if (pendingFiles.length === 0) {
      return;
    }
    const titleValue = String(formData.get("title") ?? "").trim();

    let succeeded = 0;
    let hasJobFailure = false;
    try {
      for (const uploadFile of pendingFiles) {
        setFiles((prev) =>
          prev.map((file) =>
            file.id === uploadFile.id
              ? { ...file, status: "uploading" as const, progress: 25, error: undefined }
              : file.status === "uploading"
                ? { ...file, status: "pending" as const, progress: 0 }
                : file,
          ),
        );

        const request = new FormData();
        request.set("file", uploadFile.file);
        const fallbackTitle = uploadFile.file.name.replace(/\.[^/.]+$/, "");
        const perFileTitle = pendingFiles.length === 1 ? titleValue || fallbackTitle : fallbackTitle;
        request.set("title", perFileTitle);

        try {
          const result = await action(request);
          if (!result.ok) {
            setFiles((prev) =>
              prev.map((file) =>
                file.id === uploadFile.id
                  ? { ...file, status: "error" as const, error: result.error }
                  : file,
              ),
            );
            continue;
          }

          succeeded += 1;
          hasJobFailure = hasJobFailure || result.uploadNotice === "failed";
          setFiles((prev) =>
            prev.map((file) =>
              file.id === uploadFile.id
                ? { ...file, status: "success" as const, progress: 100, error: undefined }
                : file,
            ),
          );
        } catch {
          setFiles((prev) =>
            prev.map((file) =>
              file.id === uploadFile.id
                ? {
                    ...file,
                    status: "error" as const,
                    progress: 0,
                    error: "Upload failed. Please try again.",
                  }
                : file,
            ),
          );
        }
      }
    } finally {
      if (succeeded === pendingFiles.length) {
        const uploadNotice = hasJobFailure ? "failed" : "processing";
        router.push(`${pathname}?uploaded=${uploadNotice}`);
        return;
      }
      if (succeeded > 0) {
        router.refresh();
      }
    }
  };

  return (
    <form className="space-y-4" action={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          placeholder="Lecture 3: Limits and Continuity"
          disabled={files.length > 1}
          className="disabled:bg-[var(--surface-muted)] disabled:text-ui-muted"
        />
        {files.length > 1 ? (
          <p className="text-xs text-ui-muted">
            Multiple files detected. Each file will be uploaded with its filename as title.
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>Files</Label>
        <FileUploadZone
          accept=".pdf,.docx,.pptx"
          maxSizeMB={maxSizeMb}
          maxFiles={10}
          onFilesChange={setFiles}
        />
      </div>
      <SubmitButton fileCount={pendingFilesCount(files)} />
      <UploadProgress />
    </form>
  );
}

function pendingFilesCount(files: UploadFile[]) {
  return files.filter((file) => file.status === "pending").length;
}
