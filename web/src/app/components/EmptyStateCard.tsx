import Link from "next/link";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type EmptyStateAction = {
  label: string;
  href: string;
  variant?: "default" | "outline";
};

type EmptyStateCardProps = {
  icon: keyof typeof AppIcons;
  title: string;
  description: string;
  className?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
};

export default function EmptyStateCard({
  icon,
  title,
  description,
  className,
  primaryAction,
  secondaryAction,
}: EmptyStateCardProps) {
  const Icon = AppIcons[icon];

  return (
    <Card className={cn("rounded-2xl border-dashed bg-[var(--surface-muted)] p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-default bg-white text-ui-muted">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ui-primary">{title}</h3>
          <p className="mt-1 text-sm text-ui-muted">{description}</p>
          {primaryAction || secondaryAction ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {primaryAction ? (
                <Button asChild size="sm" variant={primaryAction.variant ?? "default"}>
                  <Link href={primaryAction.href}>{primaryAction.label}</Link>
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button asChild size="sm" variant={secondaryAction.variant ?? "outline"}>
                  <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
