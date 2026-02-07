import { describe, expect, it } from "vitest";
import {
  parseQuestionCount,
  parseQuizAnswers,
  parseQuizDraftPayload,
  validateQuizGenerationPayload,
} from "@/lib/quiz/validation";

describe("quiz validation", () => {
  it("validates generation payload", () => {
    const result = validateQuizGenerationPayload({
      questions: [
        {
          question: "What is 2 + 2?",
          choices: ["3", "4", "5", "6"],
          answer: "4",
          explanation: "Adding two and two yields four by basic arithmetic.",
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid generation payload", () => {
    const result = validateQuizGenerationPayload({
      questions: [
        {
          question: "What is 2 + 2?",
          choices: ["3", "4"],
          answer: "4",
          explanation: "Adding two and two yields four by basic arithmetic.",
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("parses draft payload", () => {
    const payload = parseQuizDraftPayload(
      JSON.stringify({
        title: "Quiz 1",
        instructions: "Be precise.",
        questions: [
          {
            question: "What is 2 + 2?",
            choices: ["3", "4", "5", "6"],
            answer: "4",
            explanation: "Adding two and two yields four by basic arithmetic.",
          },
        ],
      }),
    );

    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].answer).toBe("4");
  });

  it("parses answers payload", () => {
    const answers = parseQuizAnswers(
      JSON.stringify([
        {
          questionId: "q1",
          selectedChoice: "4",
        },
      ]),
    );

    expect(answers).toEqual([{ questionId: "q1", selectedChoice: "4" }]);
  });

  it("enforces question count bounds", () => {
    expect(parseQuestionCount("10")).toBe(10);
    expect(() => parseQuestionCount("0")).toThrow();
    expect(() => parseQuestionCount("21")).toThrow();
  });
});
