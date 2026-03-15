"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  students: ClassInsightsPayload["students"];
};

export default function StudentEngagementScatter({ students }: Props) {
  if (students.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Student Engagement</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ui-muted">No student data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const data = students.map((s) => ({
    x: Math.round(s.completion_rate * 100),
    y: Math.round(s.avg_score * 100),
    z: Math.max(40, s.chat_message_count * 15 + 40),
    name: s.display_name,
    risk: s.risk_level,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Engagement</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-ui-muted">
          X = completion rate · Y = score · bubble size = chat messages
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, 100]}
              name="Completion"
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              name="Score"
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="z" range={[40, 400]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-lg border border-default bg-white p-2 text-xs shadow">
                    <p className="font-medium">{d.name}</p>
                    <p>Score: {d.y}%</p>
                    <p>Completion: {d.x}%</p>
                  </div>
                );
              }}
            />
            <Scatter data={data} fill="#f59e0b" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
