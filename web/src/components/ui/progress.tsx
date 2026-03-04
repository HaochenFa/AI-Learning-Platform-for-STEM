"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressProps = React.ComponentProps<"div"> & {
  value?: number;
};

function Progress({ className, value = 0, ...props }: ProgressProps) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div
      data-slot="progress"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-[var(--border-default)]", className)}
      {...props}
    >
      <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${width}%` }} />
    </div>
  );
}

export { Progress };
