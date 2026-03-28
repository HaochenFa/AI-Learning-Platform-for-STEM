"use client";

import { useState } from "react";
import { AppIcons } from "@/components/icons";
import { cn } from "@/lib/utils";

type AccountType = "teacher" | "student";

type AccountTypeSelectorProps = {
  defaultValue: AccountType;
};

const ROLE_CONTENT: Record<
  AccountType,
  {
    label: string;
    badge: string;
    description: string;
    helper: string;
  }
> = {
  teacher: {
    label: "Teacher",
    badge: "Manage",
    description: "Upload materials, shape the blueprint, and publish class activities.",
    helper: "Teacher accounts create classes, curate AI outputs, and assign learning work.",
  },
  student: {
    label: "Student",
    badge: "Learn",
    description: "Join classes, open assigned activities, and study inside the published flow.",
    helper: "Student accounts join teacher-led classes and work through assigned activities.",
  },
};

export default function AccountTypeSelector({ defaultValue }: AccountTypeSelectorProps) {
  const [selected, setSelected] = useState<AccountType>(defaultValue);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ui-muted">Account type</legend>
      <p className="text-xs leading-5 text-ui-muted">
        Choose how you&apos;ll use the platform. Account type can&apos;t be changed after signup.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {(Object.entries(ROLE_CONTENT) as [AccountType, (typeof ROLE_CONTENT)[AccountType]][]).map(
          ([value, content]) => {
            const isSelected = selected === value;

            return (
              <label key={value} className="block">
                <input
                  type="radio"
                  name="account_type"
                  value={value}
                  checked={isSelected}
                  onChange={() => setSelected(value)}
                  aria-label={content.label}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "auth-choice flex min-h-[5.5rem] flex-col justify-between rounded-2xl border px-4 py-3 text-left",
                    isSelected ? "auth-choice-active" : "auth-choice-idle",
                  )}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-sm font-semibold text-ui-primary">{content.label}</span>
                      <span
                        className={cn(
                          "mt-1 block text-xs leading-5",
                          isSelected ? "text-ui-primary" : "text-ui-muted",
                        )}
                      >
                        {content.description}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "auth-choice-indicator flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        isSelected ? "auth-choice-indicator-active" : "auth-choice-indicator-idle",
                      )}
                      aria-hidden="true"
                    >
                      <AppIcons.check className="h-3.5 w-3.5" />
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-3 text-[11px] font-semibold uppercase tracking-[0.18em]",
                      isSelected ? "text-accent-strong" : "text-ui-subtle",
                    )}
                  >
                    {content.badge}
                  </span>
                </span>
              </label>
            );
          },
        )}
      </div>

      <p className="auth-choice-hint rounded-2xl px-4 py-3 text-sm leading-6 text-ui-muted">
        {ROLE_CONTENT[selected].helper}
      </p>
    </fieldset>
  );
}
