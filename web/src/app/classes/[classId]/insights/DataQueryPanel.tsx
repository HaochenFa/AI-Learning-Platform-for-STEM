"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppIcons } from "@/components/icons";
import { queryClassData } from "@/lib/actions/insights";
import GenerativeCanvas from "@/components/canvas/GenerativeCanvas";
import type { CanvasSpec } from "@/lib/chat/types";
import type { CanvasState } from "@/components/canvas";

type DataQueryPanelProps = {
  classId: string;
};

/**
 * Natural-language query panel that generates a `GenerativeCanvas` chart
 * from the teacher's free-text question about their class data.
 *
 * **Flow:** Teacher types a question (max 500 chars) → `queryClassData` is
 * called on the backend → the AI returns a `CanvasSpec` → `GenerativeCanvas`
 * renders the appropriate chart type (bar, line, scatter, etc.).
 *
 * The submit call is wrapped in `startTransition` so the input textarea
 * remains interactive while the server round-trip is in-flight.
 *
 * @param classId The class UUID — forwarded to `queryClassData` for RLS scoping.
 */
export default function DataQueryPanel({ classId }: DataQueryPanelProps) {
  const [query, setQuery] = useState("");
  const [canvasStatus, setCanvasStatus] = useState<CanvasState>("idle");
  const [canvasSpec, setCanvasSpec] = useState<CanvasSpec | undefined>(undefined);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setCanvasStatus("loading");
    setCanvasError(null);

    startTransition(async () => {
      setCanvasSpec(undefined);
      const result = await queryClassData(classId, query.trim());
      if (result.ok) {
        setCanvasSpec(result.spec);
        setCanvasStatus("revealed");
      } else {
        setCanvasError(result.error);
        setCanvasStatus("error");
      }
    });
  }

  const isDisabled = isPending || !query.trim();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-ui-muted">
          Ask about your data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            rows={4}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Which topics had the lowest scores? Which students need support?"
            maxLength={500}
            className="w-full rounded-xl border border-default bg-[var(--surface-card,white)] px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
          />
          <p className="text-xs text-ui-muted">{query.length}/500</p>
          <Button
            type="submit"
            variant="warm"
            disabled={isDisabled}
            className="flex items-center gap-2"
          >
            {isPending ? (
              <>
                <AppIcons.loading className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <AppIcons.sparkles className="h-4 w-4" />
                Generate Chart
              </>
            )}
          </Button>
        </form>

        <GenerativeCanvas
          state={canvasStatus}
          spec={canvasSpec ?? null}
          error={canvasError}
        />
      </CardContent>
    </Card>
  );
}
