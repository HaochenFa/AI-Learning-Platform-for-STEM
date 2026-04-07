import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocalizedDateTimeText } from "@/components/ui/localized-date-time";

type AssignmentRecipientStatus = "assigned" | "in_progress" | "submitted" | "reviewed";

type TeacherFeedbackPanelProps = {
  status: AssignmentRecipientStatus;
  score: number | null;
  comment: string;
  highlights: string[];
  reviewedAt: string | null;
  submissionLabel?: string;
};

export default function TeacherFeedbackPanel({
  status,
  score,
  comment,
  highlights,
  reviewedAt,
  submissionLabel,
}: TeacherFeedbackPanelProps) {
  const hasWrittenFeedback = comment.trim().length > 0 || highlights.length > 0;

  return (
    <Card className="mb-6 rounded-2xl border-accent bg-accent-soft">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base text-accent">Teacher feedback</CardTitle>
          <Badge variant={status === "reviewed" ? "success" : "outline"}>
            {status === "reviewed" ? "Reviewed" : "In progress"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        {submissionLabel ? <p className="text-ui-muted">{submissionLabel}</p> : null}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-ui-subtle">
          <p>Score: {score === null ? "Not provided" : `${score}%`}</p>
          {reviewedAt ? (
            <p>
              <LocalizedDateTimeText value={reviewedAt} prefix="Reviewed: " />
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">Comment</p>
          <p className="whitespace-pre-wrap text-ui-primary">
            {comment.trim() || "Your teacher has reviewed this submission."}
          </p>
        </div>

        {hasWrittenFeedback && highlights.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-ui-muted">Highlights</p>
            <ul className="list-disc space-y-1 pl-5 text-ui-primary">
              {highlights.map((highlight, index) => (
                <li key={`${highlight}-${index}`}>{highlight}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
