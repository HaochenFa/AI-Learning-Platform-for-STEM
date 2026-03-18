"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppIcons } from "@/components/icons";
import { queryClassData } from "@/lib/actions/insights";
import type { ClassInsightsPayload } from "@/lib/actions/insights";
import GenerativeCanvas from "@/components/canvas/GenerativeCanvas";
import type { CanvasSpec } from "@/lib/chat/types";
import type { CanvasState } from "@/components/canvas";

type Props = {
  narrative: ClassInsightsPayload["ai_narrative"];
  classId: string;
};

export default function AIInsightPanel({ narrative, classId }: Props) {
  const [canvasStatus, setCanvasStatus] = useState<CanvasState>("idle");
  const [canvasSpec, setCanvasSpec] = useState<CanvasSpec | undefined>(undefined);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!narrative) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-ui-muted">
            AI summary unavailable — try refreshing.
          </p>
        </CardContent>
      </Card>
    );
  }

  function handleGenerateVisual() {
    if (!narrative) return;
    const query = [narrative.executive_summary, ...narrative.key_findings]
      .join(" ")
      .slice(0, 500);

    setCanvasStatus("loading");
    setCanvasError(null);

    startTransition(async () => {
      const result = await queryClassData(classId, query);
      if (result.ok) {
        setCanvasSpec(result.spec);
        setCanvasStatus("revealed");
      } else {
        setCanvasError(result.error);
        setCanvasStatus("error");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <AppIcons.sparkles className="h-4 w-4 text-accent" />
          AI Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ui-primary">{narrative.executive_summary}</p>
        {narrative.key_findings.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ui-muted">
              Key Findings
            </p>
            <ul className="space-y-1">
              {narrative.key_findings.map((finding, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ui-primary">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {finding}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(canvasStatus === "idle" || canvasStatus === "error") && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateVisual}
            disabled={isPending}
            className="flex items-center gap-2"
          >
            <AppIcons.sparkles className="h-4 w-4" />
            Generate Visual Summary
          </Button>
        )}

        {canvasStatus === "revealed" && (
          <p className="text-sm text-ui-muted">Visual generated</p>
        )}

        {isPending && canvasStatus === "loading" && (
          <div className="flex items-center gap-2">
            <AppIcons.loading className="h-4 w-4 animate-spin text-ui-muted" />
            <span className="text-sm text-ui-muted">Generating visual…</span>
          </div>
        )}

        <GenerativeCanvas
          state={canvasStatus}
          spec={canvasSpec ?? null}
          error={canvasError}
        />
      </CardContent>
    </Card>
  );
}
