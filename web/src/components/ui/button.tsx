import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity] duration-200 disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border border-accent bg-accent px-4 py-2 text-ui-primary hover:bg-accent-strong",
        destructive: "border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100",
        outline:
          "border border-default bg-white text-ui-muted hover:border-accent hover:bg-accent-soft hover:text-accent",
        secondary:
          "border border-default bg-[var(--surface-muted)] text-ui-muted hover:border-accent hover:text-ui-primary",
        ghost: "text-ui-muted hover:bg-accent-soft hover:text-accent",
        link: "px-0 text-accent underline-offset-4 hover:underline",
        warm: "border border-accent bg-accent text-ui-primary hover:bg-accent-strong"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
