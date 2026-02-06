import { describe, expect, it } from "vitest";
import { gradeQuizAttempt } from "@/lib/quiz/grading";

describe("quiz grading", () => {
  it("grades exact-match mcq answers", () => {
    const graded = gradeQuizAttempt({
      questions: [
        {
          id: "q1",
          question: "1 + 1",
          choices: ["1", "2", "3", "4"],
          answer: "2",
          explanation: "Basic addition.",
          orderIndex: 0,
        },
        {
          id: "q2",
          question: "2 + 2",
          choices: ["2", "3", "4", "5"],
          answer: "4",
          explanation: "Basic addition.",
          orderIndex: 1,
        },
      ],
      answers: [
        { questionId: "q1", selectedChoice: "2" },
        { questionId: "q2", selectedChoice: "3" },
      ],
    });

    expect(graded.scoreRaw).toBe(1);
    expect(graded.maxPoints).toBe(2);
    expect(graded.scorePercent).toBe(50);
    expect(graded.evaluatedAnswers[0].isCorrect).toBe(true);
    expect(graded.evaluatedAnswers[1].isCorrect).toBe(false);
  });
});
