import { describe, expect, it } from "vitest";
import {
  buildBlueprintPrompt,
  parseBlueprintResponse,
  validateBlueprintPayload,
} from "@/lib/ai/blueprint";

const validPayload = {
  schemaVersion: "v2",
  summary: "This course builds from limits to derivatives and applications in scientific models.",
  assumptions: ["Students are fluent with algebraic manipulation."],
  uncertaintyNotes: ["Some enrichment examples may require instructor curation."],
  qualityRubric: {
    coverageCompleteness: "high",
    logicalProgression: "high",
    evidenceGrounding: "medium",
    notes: ["Derived from provided lecture slides and notes."],
  },
  topics: [
    {
      key: "limits",
      title: "Limits",
      description: "Foundational limit notation and intuition.",
      section: "Module 1",
      sequence: 1,
      prerequisites: [],
      objectives: [
        {
          statement: "Explain limit notation and evaluate basic one-sided limits.",
          level: "understand",
          masteryCriteria: "Correctly solve 4 of 5 representative limit tasks.",
        },
      ],
      assessmentIdeas: ["Short formative quiz on one-sided and two-sided limits."],
      misconceptionFlags: ["Confusing function value with limiting value."],
      evidence: [{ sourceLabel: "Source 1", rationale: "Lecture notes define formal notation." }],
    },
    {
      key: "derivatives",
      title: "Derivatives",
      description: "Derivative as limit of change and local linearity.",
      sequence: 2,
      prerequisites: ["limits"],
      objectives: [
        {
          statement: "Apply derivative rules to compute rates of change in context.",
          level: "apply",
        },
      ],
      assessmentIdeas: ["Problem set with interpreted derivatives in physics contexts."],
    },
  ],
};

describe("buildBlueprintPrompt", () => {
  it("includes materials and upgraded structure requirements", () => {
    const prompt = buildBlueprintPrompt({
      classTitle: "Calculus I",
      subject: "Mathematics",
      level: "College",
      materialCount: 2,
      materialText: "Sample material text.",
    });

    expect(prompt.system).toContain("curriculum designer");
    expect(prompt.user).toContain("Materials provided: 2");
    expect(prompt.user).toContain('"qualityRubric"');
    expect(prompt.user).toContain("sequence values must be integers");
    expect(prompt.user).toContain("Materials:");
  });
});

describe("validateBlueprintPayload", () => {
  it("accepts a valid payload", () => {
    const result = validateBlueprintPayload(validPayload);
    expect(result.ok).toBe(true);
  });

  it("rejects non-integer sequence values", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [{ ...validPayload.topics[0], sequence: 1.5 }, validPayload.topics[1]],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("sequence must be an integer"))).toBe(true);
  });

  it("rejects near-duplicate topic titles", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        validPayload.topics[0],
        {
          ...validPayload.topics[1],
          title: "limits",
          key: "limits-advanced",
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("near-duplicate"))).toBe(true);
  });

  it("rejects missing prerequisite references", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        validPayload.topics[0],
        { ...validPayload.topics[1], prerequisites: ["missing-topic"] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("references missing key"))).toBe(true);
  });

  it("rejects low-quality objective statements", () => {
    const result = validateBlueprintPayload({
      ...validPayload,
      topics: [
        {
          ...validPayload.topics[0],
          objectives: [{ statement: "Define limits", level: "understand" }],
        },
        validPayload.topics[1],
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("must be specific"))).toBe(true);
  });
});

describe("parseBlueprintResponse", () => {
  it("extracts JSON from wrapped responses", () => {
    const raw = `Blueprint:\n${JSON.stringify(validPayload)}\nDone.`;
    const parsed = parseBlueprintResponse(raw);
    expect(parsed.summary).toContain("limits");
    expect(parsed.topics[0]?.key).toBe("limits");
  });

  it("repairs trailing commas in near-valid JSON", () => {
    const raw = `{
      "summary": "This course builds from limits to derivatives and applications in scientific models.",
      "topics": [
        {
          "key": "limits",
          "title": "Limits",
          "description": "Foundational limit notation and intuition.",
          "sequence": 1,
          "prerequisites": [],
          "objectives": [{ "statement": "Explain limit notation and evaluate basic one-sided limits.", "level": "understand" }],
          "assessmentIdeas": ["Short formative quiz on one-sided and two-sided limits."],
        }
      ]
    }`;

    const parsed = parseBlueprintResponse(raw);
    expect(parsed.topics).toHaveLength(1);
    expect(parsed.topics[0]?.key).toBe("limits");
  });

  it("throws when no JSON is present", () => {
    expect(() => parseBlueprintResponse("No JSON here.")).toThrow("No JSON object found");
  });

  it("throws when JSON does not match schema", () => {
    const raw = JSON.stringify({ summary: "Ok", topics: [] });
    expect(() => parseBlueprintResponse(raw)).toThrow("Invalid blueprint JSON");
  });
});
