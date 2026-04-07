"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import FileUploadZone, { type UploadFile } from "@/app/components/FileUploadZone";
import {
  finalizeMaterialUpload,
  prepareMaterialUpload,
  triggerMaterialProcessing,
} from "@/app/classes/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { MAX_MATERIAL_BYTES } from "@/lib/materials/constants";

type MaterialUploadFormProps = {
  classId: string;
};

type BatchSummary = {
  uploadedCount: number;
  failedCount: number;
  variant: "success" | "warning" | "error";
  title: string;
  message: string;
  note?: string;
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

function updateFileState(
  files: UploadFile[],
  fileId: string,
  nextState: Partial<UploadFile>,
) {
  return files.map((file) =>
    file.id === fileId
      ? {
          ...file,
          ...nextState,
        }
      : file,
  );
}

export default function MaterialUploadForm({ classId }: MaterialUploadFormProps) {
  const maxSizeMb = Math.round(MAX_MATERIAL_BYTES / (1024 * 1024));
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const handleFilesChange = (nextFiles: UploadFile[]) => {
    setBatchSummary(null);
    setFiles(nextFiles);
  };

  const handleSubmit = async (formData: FormData) => {
    const pendingFiles = files.filter((file) => file.status === "pending");
    if (pendingFiles.length === 0) {
      return;
    }

    const titleValue = String(formData.get("title") ?? "").trim();
    setBatchSummary(null);

    let uploadedCount = 0;
    let failedCount = 0;
    let workerNote: string | undefined;

    for (const uploadFile of pendingFiles) {
      setFiles((current) =>
        updateFileState(current, uploadFile.id, {
          status: "uploading",
          progress: 15,
          error: undefined,
        }),
      );

      const fallbackTitle = uploadFile.file.name.replace(/\.[^/.]+$/, "");
      const perFileTitle =
        pendingFiles.length === 1 ? titleValue || fallbackTitle : fallbackTitle;

      try {
        const prepared = await prepareMaterialUpload(classId, {
          filename: uploadFile.file.name,
          mimeType: uploadFile.file.type,
          sizeBytes: uploadFile.file.size,
        });

        if (!prepared.ok) {
          failedCount += 1;
          setFiles((current) =>
            updateFileState(current, uploadFile.id, {
              status: "error",
              progress: 0,
              error: prepared.error,
            }),
          );
          continue;
        }

        setFiles((current) =>
          updateFileState(current, uploadFile.id, {
            progress: 45,
          }),
        );

        const uploadResult = await supabase.storage
          .from("materials")
          .uploadToSignedUrl(
            prepared.storagePath,
            prepared.uploadToken,
            uploadFile.file,
            {
              contentType: uploadFile.file.type || undefined,
              upsert: false,
            },
          );

        if (uploadResult.error) {
          failedCount += 1;
          setFiles((current) =>
            updateFileState(current, uploadFile.id, {
              status: "error",
              progress: 0,
              error: uploadResult.error.message,
            }),
          );
          continue;
        }

        setFiles((current) =>
          updateFileState(current, uploadFile.id, {
            progress: 80,
          }),
        );

        const finalized = await finalizeMaterialUpload(classId, {
          materialId: prepared.materialId,
          storagePath: prepared.storagePath,
          title: perFileTitle,
          filename: uploadFile.file.name,
          mimeType: uploadFile.file.type,
          sizeBytes: uploadFile.file.size,
          triggerWorker: false,
        });

        if (!finalized.ok) {
          failedCount += 1;
          setFiles((current) =>
            updateFileState(current, uploadFile.id, {
              status: "error",
              progress: 0,
              error: finalized.error,
            }),
          );
          continue;
        }

        uploadedCount += 1;
        setFiles((current) =>
          updateFileState(current, uploadFile.id, {
            status: "success",
            progress: 100,
            error: undefined,
          }),
        );
      } catch (error) {
        failedCount += 1;
        setFiles((current) =>
          updateFileState(current, uploadFile.id, {
            status: "error",
            progress: 0,
            error:
              error instanceof Error
                ? error.message
                : "Upload failed. Please try again.",
          }),
        );
      }
    }

    if (uploadedCount > 0) {
      const workerTrigger = await triggerMaterialProcessing(classId, uploadedCount);
      if (!workerTrigger.ok) {
        workerNote =
          "The upload was queued, but the worker could not be woken immediately. Processing should resume on the next scheduled run.";
      }
    }

    if (uploadedCount === pendingFiles.length) {
      setFiles([]);
      router.push(`${pathname}?uploaded=processing`);
      return;
    }

    if (uploadedCount > 0) {
      setFiles((current) => current.filter((file) => file.status !== "success"));
      router.refresh();
    }

    if (uploadedCount > 0 && failedCount > 0) {
      setBatchSummary({
        uploadedCount,
        failedCount,
        variant: "warning",
        title: "Batch upload finished with issues",
        message: `${uploadedCount} uploaded, ${failedCount} failed.`,
        note: workerNote,
      });
      return;
    }

    if (uploadedCount > 0) {
      setBatchSummary({
        uploadedCount,
        failedCount,
        variant: "success",
        title: "Batch upload finished",
        message: `${uploadedCount} uploaded successfully.`,
        note: workerNote,
      });
      return;
    }

    setBatchSummary({
      uploadedCount,
      failedCount,
      variant: "error",
      title: "Upload failed",
      message:
        failedCount === 1
          ? "1 file failed to upload."
          : `${failedCount} files failed to upload.`,
    });
  };

  return (
    <form className="space-y-4" action={handleSubmit}>
      {batchSummary ? (
        <Alert variant={batchSummary.variant} aria-live="polite">
          <AlertTitle>{batchSummary.title}</AlertTitle>
          <AlertDescription>
            <p>{batchSummary.message}</p>
            {batchSummary.note ? <p className="mt-1">{batchSummary.note}</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

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
          files={files}
          accept=".pdf,.docx,.pptx"
          maxSizeMB={maxSizeMb}
          maxFiles={10}
          onFilesChange={handleFilesChange}
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
