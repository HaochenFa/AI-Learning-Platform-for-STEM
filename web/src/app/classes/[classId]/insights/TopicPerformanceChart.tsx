"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  topics: ClassInsightsPayload["topics"];
};

/* Recharts needs raw hex — pull from computed CSS vars at render time */
const STATUS_CHART_COLORS = {
  critical: "#f43e5e", /* matches --status-error-border base hue */
  warning: "#f59e0b",  /* matches --status-warning-border base hue */
  good: "#10b981",     /* matches --status-success-border base hue */
} as const;

function statusColor(status: "good" | "warning" | "critical") {
  return STATUS_CHART_COLORS[status];
}

export default function TopicPerformanceChart({ topics }: Props) {
  if (topics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Topic Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ui-muted">No topic data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const data = topics.map((t) => ({
    name: t.title.length > 20 ? `${t.title.slice(0, 18)}…` : t.title,
    score: Math.round(t.avg_score * 100),
    status: t.status,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Topic Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [`${v}%`, "Avg score"]} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell key={index} fill={statusColor(entry.status)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex gap-4 text-xs text-ui-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_CHART_COLORS.good }} />Good (&gt;75%)</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_CHART_COLORS.warning }} />Warning (60–75%)</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_CHART_COLORS.critical }} />Critical (&lt;60%)</span>
        </div>
      </CardContent>
    </Card>
  );
}
