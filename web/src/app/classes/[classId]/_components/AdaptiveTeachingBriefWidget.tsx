"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppIcons } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  refreshClassTeachingBrief,
  type TeachingBriefActionResult,
} from "@/lib/actions/teaching-brief";

type AdaptiveTeachingBriefWidgetProps = {
  state: TeachingBriefActionResult;
  classId?: string;
  onRefresh?: () => void | Promise<void>;
};

function formatGeneratedAt(generatedAt: string | null) {
  if (!generatedAt) return null;

  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `Updated ${date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function AdaptiveTeachingBriefWidget({
  state,
  classId,
  onRefresh,
}: AdaptiveTeachingBriefWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [liveState, setLiveState] = useState(state);
  const autoRefreshAttemptedRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const generatedLabel = useMemo(() => formatGeneratedAt(liveState.generatedAt), [liveState.generatedAt]);
  const hasPayload = !!liveState.payload;

  useEffect(() => {
    setLiveState(state);
    if (!state.isStale || state.status === "generating") {
      autoRefreshAttemptedRef.current = false;
    }
  }, [state]);

  async function runRefresh() {
    if (!classId || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;

    try {
      const nextState = await refreshClassTeachingBrief(classId);
      setLiveState(nextState);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh teaching brief.";
      setLiveState((current) => ({
        ...current,
        status: "error",
        isRefreshing: false,
        error: message,
      }));
    } finally {
      refreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (
      !classId ||
      !liveState.isStale ||
      liveState.status === "generating" ||
      autoRefreshAttemptedRef.current
    ) {
      return;
    }

    autoRefreshAttemptedRef.current = true;
    void runRefresh();
  }, [classId, liveState.isStale, liveState.status]);

  async function handleRefresh() {
    if (onRefresh) {
      await onRefresh();
      return;
    }

    await runRefresh();
  }

  return (
    <Card className="border-accent/40 bg-accent-soft/40 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-ui-primary">
              <AppIcons.sparkles className="h-4 w-4 text-accent" />
              Adaptive Teaching Brief
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-ui-muted">
            {generatedLabel ? <span>{generatedLabel}</span> : null}
            {liveState.isStale ? <span>Outdated</span> : null}
            {liveState.isRefreshing ? <span>Refreshing</span> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {liveState.status === "no_data" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-ui-primary">No data yet</p>
            <p className="text-sm text-ui-muted">
              There is not enough student activity yet to generate a useful teaching brief.
            </p>
          </div>
        )}

        {liveState.status === "empty" && (
          <div className="space-y-3">
            <p className="text-sm text-ui-primary">
              There is enough class activity to generate today&apos;s memo-style teaching brief.
            </p>
            <Button variant="warm" size="sm" onClick={handleRefresh}>
              Create today&apos;s brief
            </Button>
          </div>
        )}

        {hasPayload && liveState.payload && (
          <>
            <div className="space-y-3">
              <p className="text-sm leading-6 text-ui-primary">{liveState.payload.summary}</p>

              <div className="rounded-2xl border border-accent/40 bg-white/70 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ui-muted">
                  Strongest recommended action
                </p>
                <p className="text-sm text-ui-primary">{liveState.payload.strongestAction}</p>
              </div>

              {liveState.status === "error" && liveState.error ? (
                <p className="text-sm text-[var(--status-error-fg)]">{liveState.error}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded((value) => !value)}
              >
                {isExpanded ? "Collapse" : "Expand"}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRefresh}>
                Refresh brief
              </Button>
            </div>

            {isExpanded && (
              <div className="space-y-4 border-t border-default pt-4">
                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    What needs attention
                  </p>
                  <ul className="space-y-2 text-sm text-ui-primary">
                    {liveState.payload.attentionItems.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    Likely misconceptions
                  </p>
                  <ul className="space-y-2 text-sm text-ui-primary">
                    {liveState.payload.misconceptions.map((item) => (
                      <li key={`${item.topicTitle}-${item.description}`}>
                        <span className="font-medium">{item.topicTitle}:</span> {item.description}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    Who to watch
                  </p>
                  <ul className="space-y-2 text-sm text-ui-primary">
                    {liveState.payload.studentsToWatch.map((student) => (
                      <li key={student.studentId}>
                        <span className="font-medium">{student.displayName}:</span> {student.reason}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    Suggested next step
                  </p>
                  <p className="text-sm text-ui-primary">{liveState.payload.nextStep}</p>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    Recommended follow-up activity
                  </p>
                  {liveState.payload.recommendedActivity ? (
                    <div className="flex items-center gap-2 text-sm text-ui-primary">
                      <Badge variant="secondary">{liveState.payload.recommendedActivity.type}</Badge>
                      <span>{liveState.payload.recommendedActivity.reason}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-ui-muted">No follow-up activity suggested.</p>
                  )}
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
                    Evidence basis
                  </p>
                  <p className="text-sm text-ui-muted">{liveState.payload.evidenceBasis}</p>
                </section>
              </div>
            )}
          </>
        )}

        {liveState.status === "error" && !hasPayload && liveState.error ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--status-error-fg)]">{liveState.error}</p>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Try again
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
