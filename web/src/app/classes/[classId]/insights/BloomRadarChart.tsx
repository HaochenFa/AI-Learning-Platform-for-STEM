"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClassInsightsPayload, BloomLevel } from "@/lib/actions/insights";

type Props = {
  bloom_breakdown: ClassInsightsPayload["bloom_breakdown"];
};

const LEVEL_LABELS: Record<BloomLevel, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};

// BLOOM_ORDER controls the axis sequence on the radar chart.
// The levels follow Bloom's taxonomy from lower-order (remember) to
// higher-order (create), which produces the expected cognitive complexity
// gradient when read clockwise around the chart.
const BLOOM_ORDER: BloomLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

/**
 * Radar chart showing class performance across Bloom's taxonomy levels.
 *
 * **Partial-data guard:** Individual Bloom levels may be `null` when no quiz
 * questions have been tagged with that cognitive level. `hasData` checks
 * whether at least one level has data before rendering the chart. Levels with
 * `null` values render as `0` on the chart to keep the axes consistent.
 *
 * @param bloom_breakdown Map of Bloom level → 0–1 average score (or `null` if
 *   no questions tagged at that level have been attempted yet).
 */
export default function BloomRadarChart({ bloom_breakdown }: Props) {
  // hasData: at least one level has been evaluated — otherwise show empty state.
  const hasData = BLOOM_ORDER.some(
    (level) => bloom_breakdown[level] != null,
  );

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bloom&apos;s Taxonomy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ui-muted">No topic data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const data = BLOOM_ORDER.map((level) => {
    const value = bloom_breakdown[level];
    return {
      level: LEVEL_LABELS[level],
      score: value != null ? Math.round(value * 100) : 0,
      hasData: value != null,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bloom&apos;s Taxonomy</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="level" tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [`${v}%`, "Score"]} />
            <Radar
              dataKey="score"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
