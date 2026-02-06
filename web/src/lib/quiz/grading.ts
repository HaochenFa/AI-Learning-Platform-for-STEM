import type { QuizAnswerInput } from "@/lib/activities/types";
import type { QuizAttemptGrade, QuizQuestion } from "@/lib/quiz/types";

export function gradeQuizAttempt(input: {
  questions: QuizQuestion[];
  answers: QuizAnswerInput[];
}): QuizAttemptGrade {
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const evaluated = input.questions.map((question) => {
    const submitted = input.answers.find((answer) => answer.questionId === question.id);
    const selectedChoice = submitted?.selectedChoice ?? "";
    const isCorrect = selectedChoice === question.answer;
    return {
      questionId: question.id,
      selectedChoice,
      isCorrect,
      correctAnswer: question.answer,
      explanation: question.explanation,
    };
  });

  const scoreRaw = evaluated.filter((answer) => answer.isCorrect).length;
  const maxPoints = input.questions.length;
  const scorePercent = maxPoints === 0 ? 0 : Math.round((scoreRaw / maxPoints) * 100);

  for (const answer of input.answers) {
    if (!questionById.has(answer.questionId)) {
      throw new Error("Submitted answers include unknown question ids.");
    }
  }

  return {
    scoreRaw,
    maxPoints,
    scorePercent,
    evaluatedAnswers: evaluated,
  };
}
