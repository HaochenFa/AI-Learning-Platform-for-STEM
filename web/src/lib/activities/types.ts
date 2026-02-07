export type ActivityType = "chat" | "quiz" | "flashcards" | "homework" | "exam_review";

export type ClassAccess = {
  found: boolean;
  isTeacher: boolean;
  isMember: boolean;
  classTitle: string;
  classOwnerId?: string;
};

export type AssignmentContext = {
  assignment: {
    id: string;
    class_id: string;
    activity_id: string;
    due_at: string | null;
  };
  activity: {
    id: string;
    title: string;
    type: ActivityType;
    status?: string | null;
    config: Record<string, unknown>;
  };
  recipient: {
    assignment_id: string;
    status: string;
  };
};

export type QuizAnswerInput = {
  questionId: string;
  selectedChoice: string;
};

export type QuizAttemptSubmissionContent = {
  mode: "quiz_attempt";
  activityId: string;
  attemptNumber: number;
  answers: QuizAnswerInput[];
  scoreRaw: number;
  scorePercent: number;
  maxPoints: number;
  submittedAt: string;
};

export type FlashcardsSessionSubmissionContent = {
  mode: "flashcards_session";
  activityId: string;
  sessionNumber: number;
  cardsReviewed: number;
  knownCount: number;
  reviewCount: number;
  scorePercent: number;
  submittedAt: string;
};
