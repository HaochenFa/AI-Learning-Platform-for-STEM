"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppIcons } from "@/components/icons";
import { getMaterialSignedUrl, deleteMaterial } from "@/app/classes/actions";

interface MaterialActionsMenuProps {
  classId: string;
  material: {
    id: string;
    title: string;
    mime_type: string | null;
    status: string | null;
    storage_path: string;
  };
}

// PDF is the only type previewable inline. docx/pptx require external conversion.
const PREVIEWABLE_MIME_TYPES = new Set(["application/pdf"]);

export function MaterialActionsMenu({ classId, material }: MaterialActionsMenuProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isProcessing = material.status === "processing";
  const canPreview = !isProcessing && PREVIEWABLE_MIME_TYPES.has(material.mime_type ?? "");

  function clearError() {
    setError(null);
  }

  const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // 50 MB

  async function handlePreview() {
    clearError();
    if (!canPreview) {
      setPreviewOpen(true);
      return;
    }
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const result = await getMaterialSignedUrl(classId, material.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const res = await fetch(result.url);
      if (!res.ok) {
        setError("Failed to load file for preview.");
        return;
      }
      // Guard against loading very large files into browser memory
      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_PREVIEW_BYTES) {
        setError("File is too large to preview in-browser. Use Download instead.");
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewUrl(blobUrl);
    } catch {
      setError("Failed to load file for preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownload() {
    clearError();
    const result = await getMaterialSignedUrl(classId, material.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Supabase signed URL — create a temporary anchor to trigger browser download
    const filename = material.storage_path.split("/").pop() ?? material.title;
    const link = document.createElement("a");
    link.href = result.url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleDeleteConfirm() {
    startTransition(async () => {
      clearError();
      const result = await deleteMaterial(classId, material.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isProcessing}
            aria-label="Material actions"
            className="h-7 w-7 text-ui-muted hover:text-ui-primary"
          >
            <AppIcons.moreActions className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={handlePreview} disabled={isProcessing}>
            <AppIcons.preview className="mr-2 h-4 w-4" />
            Preview
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleDownload} disabled={isProcessing}>
            <AppIcons.download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => { clearError(); setDeleteOpen(true); }}
            className="text-[var(--status-error-fg,#9f1239)] focus:text-[var(--status-error-fg,#9f1239)]"
          >
            <AppIcons.trash className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => {
        setPreviewOpen(open);
        if (!open) {
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
          }
          setPreviewUrl(null);
          setPreviewLoading(false);
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{material.title}</DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex h-[65vh] w-full items-center justify-center">
              <p className="text-sm text-ui-muted">Loading preview…</p>
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-[var(--status-error-fg,#9f1239)]">
              {error}
            </p>
          ) : previewUrl ? (
            <div className="h-[65vh] w-full overflow-hidden rounded-lg border border-default">
              <iframe
                src={previewUrl}
                title={material.title}
                className="h-full w-full"
              />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-ui-muted">
              Preview is not available for this file type. Use Download instead.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) clearError(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete material?</DialogTitle>
            <DialogDescription>
              <strong>{material.title}</strong> will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-[var(--status-error-fg,#9f1239)]">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
