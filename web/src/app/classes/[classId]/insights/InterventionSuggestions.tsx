"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  classId: string;
  interventions: NonNullable<ClassInsightsPayload["ai_narrative"]>["interventions"];
};

/**
 * List of AI-generated intervention suggestions for underperforming topics.
 *
 * Each intervention names the struggling topic, explains why it was flagged,
 * suggests a remediation action, and provides a one-click link to generate
 * a targeted quiz for that topic (pre-filled via `?topicId=` query param).
 *
 * Returns `null` when the intervention list is empty — the parent conditionally
 * renders this component only when `interventions.length > 0`.
 *
 * @param classId The class UUID — used to build the quiz creation URL.
 * @param interventions AI-generated intervention items from `ai_narrative`.
 */
export default function InterventionSuggestions({ classId, interventions }: Props) {
  if (interventions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested Interventions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {interventions.map((intervention, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-default p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-ui-primary">
                {intervention.topic_title}
              </p>
              <p className="text-xs text-ui-muted">{intervention.reason}</p>
              <p className="text-xs text-ui-primary">{intervention.suggested_action}</p>
            </div>
            <div className="shrink-0">
              <Button variant="warm" size="sm" asChild>
                <Link
                  href={`/classes/${classId}/activities/quiz/new?topicId=${intervention.topic_id}`}
                >
                  Generate Quiz
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
