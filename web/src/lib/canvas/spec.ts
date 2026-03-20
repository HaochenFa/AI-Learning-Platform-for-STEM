import type { CanvasSpec, ChartDataPoint, VectorConfig, WaveConfig } from "@/lib/chat/types";

const VALID_CANVAS_TYPES = new Set<CanvasSpec["type"]>(["chart", "diagram", "wave", "vector"]);
const VALID_CHART_TYPES = new Set<Extract<CanvasSpec, { type: "chart" }>["chartType"]>([
  "bar",
  "line",
  "pie",
  "scatter",
]);
const VALID_DIAGRAM_TYPES = new Set<Extract<CanvasSpec, { type: "diagram" }>["diagramType"]>([
  "flowchart",
  "concept-map",
]);

const CANVAS_STUDENT_QUESTION_MAX_CHARS = 500;
const CANVAS_AI_ANSWER_MAX_CHARS = 2000;

type CanvasContext = {
  studentQuestion: string;
  aiAnswer: string;
};

type CanvasRecord = Record<string, unknown>;

function isRecord(value: unknown): value is CanvasRecord {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown) {
  return typeof value === "undefined" || typeof value === "string";
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isChartDataPoint(value: unknown): value is ChartDataPoint {
  return isRecord(value) && isNonEmptyString(value.label) && isFiniteNumber(value.value);
}

function isWaveConfig(value: unknown): value is WaveConfig {
  return (
    isRecord(value)
    && isNonEmptyString(value.label)
    && isFiniteNumber(value.amplitude)
    && isFiniteNumber(value.frequency)
    && isNonEmptyString(value.color)
  );
}

function isVectorConfig(value: unknown): value is VectorConfig {
  return (
    isRecord(value)
    && isNonEmptyString(value.label)
    && isFiniteNumber(value.magnitude)
    && isFiniteNumber(value.angleDeg)
    && isNonEmptyString(value.color)
  );
}

function clipCanvasText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

export function clipCanvasContext(context: CanvasContext): CanvasContext {
  return {
    studentQuestion: clipCanvasText(context.studentQuestion, CANVAS_STUDENT_QUESTION_MAX_CHARS),
    aiAnswer: clipCanvasText(context.aiAnswer, CANVAS_AI_ANSWER_MAX_CHARS),
  };
}

export function parseCanvasSpec(spec: unknown): CanvasSpec | null {
  if (!isRecord(spec) || !VALID_CANVAS_TYPES.has(spec.type as CanvasSpec["type"])) {
    return null;
  }

  if (!isNonEmptyString(spec.title)) {
    return null;
  }

  switch (spec.type) {
    case "chart":
      if (
        !VALID_CHART_TYPES.has(spec.chartType as Extract<CanvasSpec, { type: "chart" }>["chartType"])
        || !Array.isArray(spec.data)
        || !spec.data.every(isChartDataPoint)
        || !isOptionalString(spec.xLabel)
        || !isOptionalString(spec.yLabel)
      ) {
        return null;
      }
      return spec as CanvasSpec;
    case "diagram":
      if (
        !VALID_DIAGRAM_TYPES.has(spec.diagramType as Extract<CanvasSpec, { type: "diagram" }>["diagramType"])
        || !isNonEmptyString(spec.definition)
      ) {
        return null;
      }
      return spec as CanvasSpec;
    case "wave":
      if (!Array.isArray(spec.waves) || !spec.waves.every(isWaveConfig)) {
        return null;
      }
      return spec as CanvasSpec;
    case "vector":
      if (
        !Array.isArray(spec.vectors)
        || !spec.vectors.every(isVectorConfig)
        || (typeof spec.gridSize !== "undefined" && !isFiniteNumber(spec.gridSize))
      ) {
        return null;
      }
      return spec as CanvasSpec;
    default:
      return null;
  }
}
