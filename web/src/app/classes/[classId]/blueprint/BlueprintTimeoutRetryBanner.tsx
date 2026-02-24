"use client";

import { useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";

type BlueprintTimeoutRetryBannerProps = {
  message: string;
  retryAction: (formData: FormData) => void | Promise<void>;
};

export default function BlueprintTimeoutRetryBanner({
  message,
  retryAction,
}: BlueprintTimeoutRetryBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
      <p>{message}</p>
      <form action={retryAction} className="mt-3">
        <PendingSubmitButton
          label="Retry generation"
          pendingLabel="Retrying generation..."
          debounceMs={1200}
          onBeforeSubmit={() => setIsVisible(false)}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </form>
    </div>
  );
}
