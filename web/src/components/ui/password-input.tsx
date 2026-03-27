"use client";

import * as React from "react";
import { AppIcons } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const ToggleIcon = isVisible ? AppIcons.previewOff : AppIcons.preview;
  const toggleLabel = isVisible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <Input {...props} type={isVisible ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-ui-muted outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-pressed={isVisible}
        onClick={() => setIsVisible((value) => !value)}
      >
        <ToggleIcon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{toggleLabel}</span>
      </button>
    </div>
  );
}

export { PasswordInput };
