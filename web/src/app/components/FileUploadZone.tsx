"use client";

import { useState, useRef, useCallback } from "react";
import { AppIcons } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type UploadFile = {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
};

type FileUploadZoneProps = {
  accept?: string;
  maxSizeMB?: number;
  maxFiles?: number;
  onFilesChange?: (files: UploadFile[]) => void;
  disabled?: boolean;
};

const createFileId = () => Math.random().toString(36).substring(2, 11);

export function createUploadFile(file: File): UploadFile {
  return {
    id: createFileId(),
    file,
    progress: 0,
    status: "pending",
  };
}

export default function FileUploadZone({
  accept = ".pdf,.docx,.pptx",
  maxSizeMB = 10,
  maxFiles = 10,
  onFilesChange,
  disabled = false,
}: FileUploadZoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validateFile = useCallback(
    (file: File): string | null => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      const allowedExts = accept.split(",").map((e) => e.trim().toLowerCase());
      if (!allowedExts.includes(ext) && !allowedExts.includes(ext.replace(".", ""))) {
        return `File type ${ext} not allowed. Accepted: ${accept}`;
      }
      if (file.size > maxSizeBytes) {
        return `File size exceeds ${maxSizeMB}MB limit`;
      }
      return null;
    },
    [accept, maxSizeBytes, maxSizeMB],
  );

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles);

      if (files.length + fileArray.length > maxFiles) {
        alert(`Maximum ${maxFiles} files allowed`);
        return;
      }

      const validFiles: UploadFile[] = [];
      for (const file of fileArray) {
        const error = validateFile(file);
        validFiles.push({
          id: createFileId(),
          file,
          progress: 0,
          status: error ? "error" : "pending",
          error: error ?? undefined,
        });
      }

      setFiles((prev) => {
        const updated = [...prev, ...validFiles];
        onFilesChange?.(updated);
        return updated;
      });
    },
    [files.length, maxFiles, onFilesChange, validateFile],
  );

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const updated = prev.filter((f) => f.id !== id);
        onFilesChange?.(updated);
        return updated;
      });
    },
    [onFilesChange],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      addFiles(e.dataTransfer.files);
    },
    [addFiles, disabled],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles],
  );

  const handleClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.includes("pdf")) {
      return <AppIcons.fileText className="h-5 w-5 text-rose-600" />;
    }
    if (type.includes("word") || type.includes("document")) {
      return <AppIcons.fileText className="h-5 w-5 text-blue-600" />;
    }
    if (type.includes("powerpoint") || type.includes("presentation")) {
      return <AppIcons.file className="h-5 w-5 text-orange-600" />;
    }
    return <AppIcons.file className="h-5 w-5 text-subtle" />;
  };

  return (
    <div className="space-y-4">
      <Card
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          "cursor-pointer border-2 border-dashed p-8 text-center transition-colors duration-200",
          disabled && "cursor-not-allowed bg-[var(--surface-muted)]",
          isDragging && !disabled && "bg-[var(--surface-muted)]",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={handleFileSelect}
          disabled={disabled}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <div className={cn("rounded-full p-3", isDragging ? "bg-[var(--border-default)]" : "bg-[var(--surface-muted)]")}>
            <AppIcons.upload className={cn("h-8 w-8", isDragging ? "text-ui-primary" : "text-ui-muted")} />
          </div>
          <div>
            <p className="text-sm font-medium text-ui-primary">
              {isDragging ? "Drop files here" : "Drag and drop files here"}
            </p>
            <p className="mt-1 text-xs text-subtle">
              or click to browse (max {maxFiles} files, {maxSizeMB}MB each)
            </p>
          </div>
          <p className="text-xs text-subtle">Accepted: {accept}</p>
        </div>
      </Card>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ui-primary">Files ({files.length})</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFiles([]);
                onFilesChange?.([]);
              }}
              className="text-xs"
            >
              Clear all
            </Button>
          </div>
          <ul className="space-y-2">
            {files.map((file) => (
              <li key={file.id}>
                <Card className={cn("rounded-lg border p-3", file.status === "error" && "border-rose-200 bg-rose-50") }>
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">{getFileIcon(file.file.type)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ui-primary">{file.file.name}</p>
                      <p className="text-xs text-subtle">{formatFileSize(file.file.size)}</p>
                      {file.error ? (
                        <Alert variant="error" className="mt-2 py-2 text-xs">
                          {file.error}
                        </Alert>
                      ) : null}
                      {file.status === "uploading" ? (
                        <div className="mt-2">
                          <Progress value={file.progress} />
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(file.id)}
                      disabled={file.status === "uploading"}
                      className="h-8 w-8"
                    >
                      <AppIcons.error className="h-4 w-4" />
                      <span className="sr-only">Remove file</span>
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
