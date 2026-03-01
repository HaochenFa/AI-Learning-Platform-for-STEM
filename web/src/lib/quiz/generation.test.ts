import { describe, expect, it } from "vitest";
import { buildQuizGenerationPrompt, parseQuizGenerationResponse } from "@/lib/quiz/generation";

describe("buildQuizGenerationPrompt", () => {
  it("includes quality and grounding guidance", () => {
    const prompt = buildQuizGenerationPrompt({
      classTitle: "Physics 101",
      questionCount: 5,
      instructions: "Prioritize Newtonian mechanics.",
      blueprintContext: "Topic 1: Kinematics",
      materialContext: "Source 1 | Notes | page 1",
    });

    expect(prompt.system).toContain("assessment designer");
    expect(prompt.user).toContain("Cover multiple blueprint topics/objectives");
    expect(prompt.user).toContain("Avoid weak distractors");
    expect(prompt.user).toContain("Question count: 5");
  });
});

describe("parseQuizGenerationResponse", () => {
  it("parses valid response", () => {
    const parsed = parseQuizGenerationResponse(
      JSON.stringify({
        questions: [
          {
            question: "Which expression gives instantaneous rate of change at a point?",
            choices: [
              "Average velocity over a long interval",
              "The derivative evaluated at that point",
              "The y-intercept of the tangent line",
              "The integral from zero to that point",
            ],
            answer: "The derivative evaluated at that point",
            explanation:
              "Instantaneous rate of change is defined by the derivative at the specific point.",
          },
        ],
      }),
    );
    expect(parsed.questions).toHaveLength(1);
  });

  it("rejects duplicate stems and low-quality distractors", () => {
    expect(() =>
      parseQuizGenerationResponse(
        JSON.stringify({
          questions: [
            {
              question: "What is acceleration in mechanics?",
              choices: ["Velocity", "Rate of change of velocity", "all of the above", "Distance"],
              answer: "Rate of change of velocity",
              explanation:
                "Acceleration is defined as the rate of change of velocity with respect to time.",
            },
            {
              question: "What is acceleration in mechanics?",
              choices: ["Mass", "Rate of change of velocity", "Force", "Impulse"],
              answer: "Rate of change of velocity",
              explanation:
                "This follows directly from the kinematics definition of acceleration in context.",
            },
          ],
        }),
      ),
    ).toThrow("Invalid quiz JSON");
  });

  it("parses wrapped responses with multiple top-level objects", () => {
    const parsed = parseQuizGenerationResponse(
      [
        '{"meta":"debug"}',
        JSON.stringify({
          questions: [
            {
              question: "What does derivative represent at a point?",
              choices: [
                "Area under the curve",
                "Instantaneous rate of change",
                "Average height",
                "Total displacement",
              ],
              answer: "Instantaneous rate of change",
              explanation:
                "By definition, the derivative at a point gives instantaneous rate of change.",
            },
          ],
        }),
      ].join("\n"),
    );

    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]?.answer).toBe("Instantaneous rate of change");
  });

  it("truncates oversized question arrays before validation", () => {
    const oversized = Array.from({ length: 22 }, (_, index) => ({
      question: `Question ${index + 1}: identify the derivative meaning variant ${index + 1}.`,
      choices: [
        `Incorrect option A ${index + 1}`,
        `Correct option ${index + 1}`,
        `Incorrect option C ${index + 1}`,
        `Incorrect option D ${index + 1}`,
      ],
      answer: `Correct option ${index + 1}`,
      explanation: `This explanation clearly justifies why option ${index + 1} is correct in class context.`,
    }));

    const parsed = parseQuizGenerationResponse(JSON.stringify({ questions: oversized }));
    expect(parsed.questions).toHaveLength(20);
  });

  it("keeps deterministic error when no valid object is present", () => {
    expect(() => parseQuizGenerationResponse("No structured output.")).toThrow(
      "No JSON object found in quiz generation response.",
    );
  });

  it("returns invalid JSON error for malformed object-only output", () => {
    expect(() => parseQuizGenerationResponse('{"questions": [}')).toThrow(
      "Quiz generation response is not valid JSON.",
    );
  });
});
