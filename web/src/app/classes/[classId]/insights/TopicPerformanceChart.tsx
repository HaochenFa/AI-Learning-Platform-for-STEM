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

function statusColor(status: "good" | "warning" | "critical") {
  if (status === "critical") return "#ef4444";
  if (status === "warning") return "#f59e0b";
  return "#22c55e";
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
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />Good (&gt;75%)</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Warning (60–75%)</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />Critical (&lt;60%)</span>
        </div>
      </CardContent>
    </Card>
  );
}
