"use client";

import { useFormStatus } from "react-dom";
import { MAX_MATERIAL_BYTES } from "@/lib/materials/constants";

type MaterialUploadFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
    >
      {pending ? "Uploading..." : "Upload material"}
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
      <div className="flex items-center gap-3 text-xs text-cyan-100">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-200/40 border-t-cyan-300" />
        Uploading your material. Large files can take a minute.
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-cyan-400/70" />
      </div>
    </div>
  );
}

export default function MaterialUploadForm({ action }: MaterialUploadFormProps) {
  const maxSizeMb = Math.round(MAX_MATERIAL_BYTES / (1024 * 1024));

  return (
    <form className="mt-6 space-y-4" action={action}>
      <div className="space-y-2">
        <label className="text-sm text-slate-300" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          placeholder="Lecture 3: Limits and Continuity"
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-slate-300" htmlFor="file">
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.docx,.pptx,image/*"
          required
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2 text-sm text-slate-100 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-400/90 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950"
        />
        <p className="text-xs text-slate-500">
          PDF, DOCX, PPTX, or image files. Max {maxSizeMb}MB.
        </p>
      </div>
      <SubmitButton />
      <UploadProgress />
    </form>
  );
}
