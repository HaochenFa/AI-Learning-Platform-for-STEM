"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  student: ClassInsightsPayload["students"][number];
  open: boolean;
  onClose: () => void;
};

function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const classes = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-green-100 text-green-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes[level]}`}
    >
      {level.charAt(0).toUpperCase() + level.slice(1)} risk
    </span>
  );
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function StudentDrillDownSheet({ student, open, onClose }: Props) {
  const chartData = student.activity_breakdown.map((a) => ({
    name: a.title.length > 16 ? `${a.title.slice(0, 14)}…` : a.title,
    score: Math.round(a.score * 100),
    attempts: a.attempts,
  }));

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{student.display_name}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <RiskBadge level={student.risk_level} />
            <span className="text-xs">Avg {pct(student.avg_score)}</span>
            <span className="text-xs">Completion {pct(student.completion_rate)}</span>
            <span className="text-xs">{student.chat_message_count} chat msgs</span>
          </SheetDescription>
        </SheetHeader>

        {student.ai_mini_summary ? (
          <div className="mt-4 rounded-xl border border-default bg-[var(--surface-muted)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">
              AI Summary
            </p>
            <p className="mt-1 text-sm text-ui-primary">{student.ai_mini_summary}</p>
          </div>
        ) : null}

        {chartData.length > 0 ? (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ui-muted">
              Activity Scores
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} layout="vertical">
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10 }}
                />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => [`${v}%`, "Score"]} />
                <Bar dataKey="score" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        {student.activity_breakdown.length > 0 ? (
          <div className="mt-4 space-y-1">
            {student.activity_breakdown.map((a) => (
              <div
                key={a.activity_id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-ui-muted">{a.title}</span>
                <span className="text-ui-primary">
                  {pct(a.score)} ({a.attempts} attempt{a.attempts !== 1 ? "s" : ""})
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
