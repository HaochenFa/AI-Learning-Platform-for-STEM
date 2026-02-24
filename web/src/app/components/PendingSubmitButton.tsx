"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
  debounceMs?: number;
  onBeforeSubmit?: () => void;
};

export default function PendingSubmitButton({
  label,
  pendingLabel,
  className,
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
    onBeforeSubmit?.();
  };

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      onClick={handleClick}
      className={`ui-motion-color ${className}`}
    >
      {pending ? (pendingLabel ?? `${label}...`) : label}
    </button>
  );
}
