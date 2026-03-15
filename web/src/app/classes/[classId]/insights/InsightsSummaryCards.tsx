import { Card, CardContent } from "@/components/ui/card";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = { summary: ClassInsightsPayload["class_summary"] };

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ui-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold text-ui-primary">{value}</p>
        {sub ? <p className="mt-0.5 text-xs text-ui-muted">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function InsightsSummaryCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard
        label="Students"
        value={summary.student_count}
        sub="enrolled"
      />
      <StatCard
        label="Avg Score"
        value={pct(summary.avg_score)}
        sub="class average"
      />
      <StatCard
        label="At Risk"
        value={summary.at_risk_count}
        sub={`of ${summary.student_count} students`}
      />
      <StatCard
        label="Engagement"
        value={summary.avg_chat_messages.toFixed(1)}
        sub="avg chat messages"
      />
    </div>
  );
}
