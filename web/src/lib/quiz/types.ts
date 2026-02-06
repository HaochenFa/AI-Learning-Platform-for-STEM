import type { QuizAnswerInput } from "@/lib/activities/types";

export type QuizQuestion = {
  id: string;
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
  orderIndex: number;
};

export type QuizGenerationQuestion = {
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
};

export type QuizGenerationPayload = {
  title?: string;
  instructions?: string;
  questions: QuizGenerationQuestion[];
};

export type QuizAttemptGrade = {
  scoreRaw: number;
  maxPoints: number;
  scorePercent: number;
  evaluatedAnswers: Array<
    QuizAnswerInput & {
      isCorrect: boolean;
      correctAnswer: string;
      explanation: string;
    }
  >;
};

export type QuizActivityConfig = {
  mode: "assignment";
  questionCount: number;
  attemptLimit: number;
  scoringPolicy: "best_of_attempts";
  revealPolicy: "after_final_attempt";
  instructions: string;
};
