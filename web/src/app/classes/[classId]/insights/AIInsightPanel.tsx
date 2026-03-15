import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppIcons } from "@/components/icons";
import type { ClassInsightsPayload } from "@/lib/actions/insights";

type Props = {
  narrative: ClassInsightsPayload["ai_narrative"];
};

export default function AIInsightPanel({ narrative }: Props) {
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
      </CardContent>
    </Card>
  );
}
