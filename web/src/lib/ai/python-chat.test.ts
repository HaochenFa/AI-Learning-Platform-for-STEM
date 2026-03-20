import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateChatCanvas } from "@/lib/ai/python-chat";

describe("generateChatCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    delete process.env.PYTHON_BACKEND_API_KEY;
  });

  it("clips the request context to the backend field limits", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            spec: {
              type: "chart",
              chartType: "bar",
              title: "Topic Scores",
              data: [{ label: "Kinematics", value: 88 }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await generateChatCanvas(
      "class-1",
      { type: "chart", concept: "topic mastery", title: "Topic Scores" },
      {
        studentQuestion: "q".repeat(700),
        aiAnswer: "a".repeat(2600),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      student_question: string;
      ai_answer: string;
    };
    expect(body.student_question).toHaveLength(500);
    expect(body.ai_answer).toHaveLength(2000);
  });

  it("rejects invalid canvas specs returned by the backend", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            spec: {
              type: "vector",
              title: "Net Force",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      generateChatCanvas(
        "class-1",
        { type: "vector", concept: "forces", title: "Net Force" },
        {
          studentQuestion: "How do the forces combine?",
          aiAnswer: "Compare each vector component before adding them together.",
        },
      ),
    ).rejects.toThrow("Canvas generation response included an invalid spec.");
  });
});
