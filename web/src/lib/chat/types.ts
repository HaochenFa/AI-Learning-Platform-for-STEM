export type ChatRole = "student" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  message: string;
  createdAt: string;
  citations?: { sourceLabel: string; snippet?: string }[];
};

export type ChatModelResponse = {
  answer: string;
  citations: { sourceLabel: string; rationale: string }[];
  safety: "ok" | "refusal";
  confidence?: "low" | "medium" | "high";
  canvas_hint?: {
    type: "chart" | "diagram" | "wave" | "vector";
    concept: string;   // e.g. "electromagnetic wave"
    title: string;     // e.g. "Wave: Frequency vs. Wavelength"
  };
};

export type ChatAssignmentSubmissionContent = {
  mode: "chat_assignment";
  activityId: string;
  transcript: ChatTurn[];
  reflection: string;
  completedAt: string;
};

export type ChatCompactionTerm = {
  term: string;
  weight: number;
  occurrences: number;
  lastSeen: string;
};

export type ChatCompactionSummary = {
  version: "v1";
  generatedAt: string;
  compactedThrough: {
    createdAt: string;
    messageId: string;
    turnCount: number;
  };
  keyTerms: ChatCompactionTerm[];
  resolvedFacts: string[];
  openQuestions: string[];
  studentNeeds: string[];
  timeline: {
    from: string;
    to: string;
    highlights: string[];
  };
};

export type ClassChatAuthorKind = "student" | "teacher" | "assistant";

export type ClassChatSession = {
  id: string;
  classId: string;
  ownerUserId: string;
  title: string;
  isPinned: boolean;
  archivedAt: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ClassChatMessage = {
  id: string;
  sessionId: string;
  classId: string;
  authorUserId: string | null;
  authorKind: ClassChatAuthorKind;
  content: string;
  citations: { sourceLabel: string; snippet?: string }[];
  safety: "ok" | "refusal" | null;
  provider: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
};

export type ClassChatMessagesPageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
};

export type ClassChatParticipant = {
  userId: string;
  displayName: string;
};

/**
 * Phase 1 intent signal returned alongside a chat response.
 * Resolved into a full CanvasSpec by the /v1/chat/canvas endpoint (Phase 2).
 */
export type CanvasHint = {
  type: "chart" | "diagram" | "wave" | "vector";
  concept: string;
  title: string;
};

export type ChartDataPoint = {
  label: string;
  value: number;
  [key: string]: string | number;
};

export type WaveConfig = {
  label: string;
  amplitude: number;
  frequency: number;
  color: string;
};

export type VectorConfig = {
  label: string;
  magnitude: number;
  angleDeg: number;
  color: string;
};

export type CanvasSpec =
  | { type: "chart"; chartType: "bar" | "line" | "pie" | "scatter"; title: string; data: ChartDataPoint[]; xLabel?: string; yLabel?: string }
  | { type: "diagram"; diagramType: "flowchart" | "concept-map"; definition: string; title: string }
  | { type: "wave"; title: string; waves: WaveConfig[] }
  | { type: "vector"; title: string; vectors: VectorConfig[]; gridSize?: number };
