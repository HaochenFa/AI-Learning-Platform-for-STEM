"use client";

import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
};

export default function PendingSubmitButton({
  label,
  pendingLabel,
  className,
  disabled = false,
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      className={`ui-motion-color ${className}`}
    >
      {pending ? pendingLabel ?? `${label}...` : label}
    </button>
  );
}
