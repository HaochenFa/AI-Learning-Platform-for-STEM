import { describe, expect, it } from "vitest";
import {
  buildBlueprintPrompt,
  parseBlueprintResponse,
  validateBlueprintPayload,
} from "@/lib/ai/blueprint";

const validPayload = {
  summary: "This course covers limits and derivatives.",
  assumptions: ["Students know basic algebra."],
  topics: [
    {
      key: "limits",
      title: "Limits",
      description: "Foundations of limits.",
      sequence: 1,
      prerequisites: [],
      objectives: [
        { statement: "Define a limit formally.", level: "understand" },
      ],
      assessmentIdeas: ["Exit ticket on limit notation."],
    },
  ],
};

describe("buildBlueprintPrompt", () => {
  it("includes materials and structure requirements", () => {
    const prompt = buildBlueprintPrompt({
      classTitle: "Calculus I",
      subject: "Mathematics",
      level: "College",
      materialCount: 2,
      materialText: "Sample material text.",
    });

    expect(prompt.system).toContain("curriculum designer");
    expect(prompt.user).toContain("Materials provided: 2");
    expect(prompt.user).toContain('"topics"');
    expect(prompt.user).toContain("Materials:");
  });

  it("falls back to default subject and level", () => {
    const prompt = buildBlueprintPrompt({
      classTitle: "Intro STEM",
      subject: null,
      level: null,
      materialCount: 1,
      materialText: "Notes",
    });

    expect(prompt.user).toContain("Subject: STEM");
    expect(prompt.user).toContain("Level: Mixed high school/college");
  });
});

describe("validateBlueprintPayload", () => {
  it("accepts a valid payload", () => {
    const result = validateBlueprintPayload(validPayload);
    expect(result.ok).toBe(true);
  });

  it("rejects payloads missing required fields", () => {
    const result = validateBlueprintPayload({ topics: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-number sequence values", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        {
          ...validPayload.topics[0],
          sequence: "first" as unknown as number,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("sequence must be a number"))
    ).toBe(true);
  });

  it("rejects objectives without statements", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        {
          ...validPayload.topics[0],
          objectives: [{ statement: "" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("statement is required"))
    ).toBe(true);
  });

  it("rejects duplicate topic keys", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        { ...validPayload.topics[0] },
        { ...validPayload.topics[0] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("duplicated"))).toBe(
      true
    );
  });

  it("rejects non-array prerequisites", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        {
          ...validPayload.topics[0],
          prerequisites: "limits" as unknown as string[],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("prerequisites must be an array"))
    ).toBe(true);
  });
});

describe("parseBlueprintResponse", () => {
  it("extracts JSON from a wrapped response", () => {
    const raw = `Here is the JSON:\n${JSON.stringify(validPayload)}\nThanks.`;
    const parsed = parseBlueprintResponse(raw);
    expect(parsed.summary).toBe(validPayload.summary);
    expect(parsed.topics[0]?.key).toBe("limits");
  });

  it("throws when no JSON is present", () => {
    expect(() => parseBlueprintResponse("No JSON here.")).toThrow(
      "No JSON object found"
    );
  });

  it("throws when JSON does not match schema", () => {
    const raw = JSON.stringify({ summary: "Ok", topics: [] });
    expect(() => parseBlueprintResponse(raw)).toThrow("Invalid blueprint JSON");
  });
});
