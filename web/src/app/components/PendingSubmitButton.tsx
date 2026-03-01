"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type buttonVariants } from "@/components/ui/button";
import { TRANSIENT_FEEDBACK_RETRY_EVENT } from "@/lib/ui/transient-feedback";
import type { VariantProps } from "class-variance-authority";

type PendingSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  className?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  disabled?: boolean;
  debounceMs?: number;
  onBeforeSubmit?: () => void;
};

export default function PendingSubmitButton({
  label,
  pendingLabel,
  className,
  variant,
  size,
  disabled = false,
  debounceMs = 0,
  onBeforeSubmit,
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const [isDebouncing, setIsDebouncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDisabled = disabled || pending || isDebouncing;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClick = () => {
    if (debounceMs > 0 && !isDebouncing) {
      setIsDebouncing(true);
      timerRef.current = setTimeout(() => {
        setIsDebouncing(false);
      }, debounceMs);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(TRANSIENT_FEEDBACK_RETRY_EVENT));
    }
    onBeforeSubmit?.();
  };

  return (
    <Button
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      onClick={handleClick}
      variant={variant}
      size={size}
      className={className}
    >
      {pending ? (pendingLabel ?? `${label}...`) : label}
    </Button>
  );
}
