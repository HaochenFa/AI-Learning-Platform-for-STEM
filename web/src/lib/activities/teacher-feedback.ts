export type TeacherFeedbackContent = {
  comment: string;
  highlights: string[];
};

export function parseTeacherFeedbackContent(content: unknown): TeacherFeedbackContent {
  if (!content || typeof content !== "object") {
    return { comment: "", highlights: [] };
  }

  const commentRaw = (content as { comment?: unknown }).comment;
  const highlightsRaw = (content as { highlights?: unknown }).highlights;

  return {
    comment: typeof commentRaw === "string" ? commentRaw : "",
    highlights: Array.isArray(highlightsRaw)
      ? highlightsRaw.filter((value): value is string => typeof value === "string")
      : [],
  };
}
