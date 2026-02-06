"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  approveBlueprint,
  createDraftFromPublished,
  saveDraft,
} from "@/app/classes/[classId]/blueprint/actions";

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const MAX_HISTORY_ENTRIES = 50;
const MAX_DRAFT_BYTES = 1_000_000;
const LOCAL_DRAFT_KEY_PREFIX = "blueprint-draft";
const MAP_NODE_WIDTH = 180;
const MAP_NODE_HEIGHT = 64;
const MAP_COLUMN_GAP = 140;
const MAP_ROW_GAP = 90;

type DraftObjective = {
  id?: string;
  statement: string;
  level?: string | null;
};

type DraftTopic = {
  id?: string;
  clientId: string;
  title: string;
  description?: string | null;
  section?: string | null;
  sequence: number;
  prerequisiteClientIds?: string[];
  objectives: DraftObjective[];
};

type DraftPayload = {
  summary: string;
  topics: DraftTopic[];
};

type DraftObjectiveState = DraftObjective & {
  clientId: string;
};

type DraftTopicState = Omit<DraftTopic, "objectives"> & {
  objectives: DraftObjectiveState[];
};

type DraftState = {
  summary: string;
  topics: DraftTopicState[];
};

type HistoryState = {
  history: DraftState[];
  cursor: number;
};

type HistoryAction =
  | { type: "set"; next: DraftState }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; next: DraftState };

type TopicMapNode = {
  id: string;
  title: string;
  x: number;
  y: number;
};

type TopicMapEdge = {
  from: string;
  to: string;
};

type TopicMapLayout = {
  nodes: TopicMapNode[];
  edges: TopicMapEdge[];
  width: number;
  height: number;
  hasCycle: boolean;
  errorMessage?: string;
};

class CycleError extends Error {
  constructor() {
    super("cycle");
  }
}

class MissingTopicError extends Error {
  constructor() {
    super("missing");
  }
}

function buildTopicMap(topics: DraftTopicState[]): TopicMapLayout {
  const graph = new Map<string, string[]>();
  topics.forEach((topic) => {
    graph.set(topic.clientId, topic.prerequisiteClientIds ?? []);
  });

  const visiting = new Set<string>();
  const depthCache = new Map<string, number>();

  const depth = (node: string): number => {
    if (depthCache.has(node)) {
      return depthCache.get(node) ?? 0;
    }
    if (visiting.has(node)) {
      throw new CycleError();
    }
    if (!graph.has(node)) {
      throw new MissingTopicError();
    }
    visiting.add(node);
    const prereqs = graph.get(node) ?? [];
    let maxDepth = 0;
    for (const prereq of prereqs) {
      maxDepth = Math.max(maxDepth, depth(prereq) + 1);
    }
    visiting.delete(node);
    depthCache.set(node, maxDepth);
    return maxDepth;
  };

  try {
    topics.forEach((topic) => depth(topic.clientId));
  } catch (error) {
    if (error instanceof CycleError) {
      return { nodes: [], edges: [], width: 0, height: 0, hasCycle: true };
    }
    if (error instanceof MissingTopicError) {
      return {
        nodes: [],
        edges: [],
        width: 0,
        height: 0,
        hasCycle: false,
        errorMessage: "Prerequisite references a missing topic.",
      };
    }
    console.error("Failed to build topic map", error);
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      hasCycle: false,
      errorMessage: "Unable to render topic map.",
    };
  }

  const layers = new Map<number, DraftTopicState[]>();
  topics.forEach((topic) => {
    const layer = depthCache.get(topic.clientId) ?? 0;
    const list = layers.get(layer) ?? [];
    list.push(topic);
    layers.set(layer, list);
  });

  const sortedLayers = Array.from(layers.entries()).sort(([a], [b]) => a - b);

  const nodes: TopicMapNode[] = [];
  let width = 0;
  let height = 0;

  sortedLayers.forEach(([layerIndex, layerTopics]) => {
    const sorted = [...layerTopics].sort((a, b) => a.sequence - b.sequence);
    sorted.forEach((topic, rowIndex) => {
      const x = layerIndex * (MAP_NODE_WIDTH + MAP_COLUMN_GAP);
      const y = rowIndex * (MAP_NODE_HEIGHT + MAP_ROW_GAP);
      nodes.push({
        id: topic.clientId,
        title: topic.title || "Untitled",
        x,
        y,
      });
      width = Math.max(width, x + MAP_NODE_WIDTH);
      height = Math.max(height, y + MAP_NODE_HEIGHT);
    });
  });

  const edges: TopicMapEdge[] = [];
  topics.forEach((topic) => {
    const prereqs = topic.prerequisiteClientIds ?? [];
    prereqs.forEach((prereq) => {
      edges.push({ from: prereq, to: topic.clientId });
    });
  });

  return {
    nodes,
    edges,
    width: Math.max(width, MAP_NODE_WIDTH),
    height: Math.max(height, MAP_NODE_HEIGHT),
    hasCycle: false,
  };
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "set": {
      const trimmed = state.history.slice(0, state.cursor + 1);
      const nextHistory = [...trimmed, action.next];
      if (nextHistory.length <= MAX_HISTORY_ENTRIES) {
        return {
          history: nextHistory,
          cursor: nextHistory.length - 1,
        };
      }

      const overflow = nextHistory.length - MAX_HISTORY_ENTRIES;
      const compacted = nextHistory.slice(overflow);
      return {
        history: compacted,
        cursor: compacted.length - 1,
      };
    }
    case "undo": {
      if (state.cursor === 0) {
        return state;
      }
      return { ...state, cursor: state.cursor - 1 };
    }
    case "redo": {
      if (state.cursor >= state.history.length - 1) {
        return state;
      }
      return { ...state, cursor: state.cursor + 1 };
    }
    case "reset": {
      return { history: [action.next], cursor: 0 };
    }
    default:
      return state;
  }
}

function SaveDraftButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full bg-cyan-400/90 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 disabled:opacity-60"
    >
      {pending ? "Saving..." : "Save draft"}
    </button>
  );
}

function StartDraftButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full border border-cyan-400/40 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Starting..." : "Start new draft"}
    </button>
  );
}

function ApproveBlueprintButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full bg-cyan-400/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
    >
      {pending ? "Approving..." : "Approve & view"}
    </button>
  );
}

function makeClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Math.random().toString(36).slice(2, 10)}`;
}

function toState(payload: DraftPayload): DraftState {
  return {
    summary: payload.summary,
    topics: payload.topics.map((topic) => ({
      ...topic,
      description: topic.description ?? "",
      section: topic.section ?? "",
      prerequisiteClientIds: topic.prerequisiteClientIds ?? [],
      clientId: topic.clientId || topic.id || makeClientId(),
      objectives: topic.objectives.map((objective) => ({
        ...objective,
        level: objective.level ?? "",
        clientId: objective.id ?? makeClientId(),
      })),
    })),
  };
}

function toPayload(state: DraftState): DraftPayload {
  return {
    summary: state.summary,
    topics: state.topics.map((topic) => ({
      id: topic.id,
      clientId: topic.clientId,
      title: topic.title,
      description: topic.description?.trim() ? topic.description : null,
      section: topic.section?.trim() ? topic.section : null,
      sequence: topic.sequence,
      prerequisiteClientIds: topic.prerequisiteClientIds ?? [],
      objectives: topic.objectives.map((objective) => ({
        id: objective.id,
        statement: objective.statement,
        level: objective.level?.trim() ? objective.level : null,
      })),
    })),
  };
}

function buildLocalDraftStorageKey(classId: string, blueprintId: string) {
  return `${LOCAL_DRAFT_KEY_PREFIX}:${classId}:${blueprintId}`;
}

type BlueprintEditorProps = {
  classId: string;
  blueprint: {
    id: string;
    summary: string;
    status: string;
    version: number;
  } | null;
  initialDraft: DraftPayload | null;
  isTeacher: boolean;
  isOwner: boolean;
};

export function BlueprintEditor({
  classId,
  blueprint,
  initialDraft,
  isTeacher,
  isOwner,
}: BlueprintEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [recoveryRefreshCount, setRecoveryRefreshCount] = useState(0);

  const initialState = useMemo(() => {
    if (!initialDraft) {
      return { summary: "", topics: [] };
    }
    return toState(initialDraft);
  }, [initialDraft]);
  const initialSerializedDraft = useMemo(() => JSON.stringify(toPayload(initialState)), [initialState]);
  const storageKey = useMemo(() => {
    if (!blueprint) {
      return null;
    }
    return buildLocalDraftStorageKey(classId, blueprint.id);
  }, [blueprint, classId]);

  const [history, dispatch] = useReducer(historyReducer, {
    history: [initialState],
    cursor: 0,
  });

  const draft = history.history[history.cursor];
  const canUndo = history.cursor > 0;
  const canRedo = history.cursor < history.history.length - 1;
  const hasChanges = history.cursor > 0;

  const topicMap = useMemo(() => buildTopicMap(draft.topics), [draft.topics]);
  const nodeById = useMemo(() => {
    return new Map(topicMap.nodes.map((node) => [node.id, node]));
  }, [topicMap.nodes]);
  const topicTitleById = useMemo(() => {
    return new Map(draft.topics.map((topic) => [topic.clientId, topic.title || "Untitled"]));
  }, [draft.topics]);
  const dependencySummary = useMemo(() => {
    if (draft.topics.length === 0) {
      return "No topics are available.";
    }
    return draft.topics
      .map((topic) => {
        const title = topic.title || "Untitled";
        const prereqs = topic.prerequisiteClientIds ?? [];
        if (prereqs.length === 0) {
          return `${title} has no prerequisites.`;
        }
        const names = prereqs.map((id) => topicTitleById.get(id) ?? "Untitled").join(", ");
        return `${title} depends on ${names}.`;
      })
      .join(" ");
  }, [draft.topics, topicTitleById]);

  const serializedDraft = useMemo(() => {
    return JSON.stringify(toPayload(draft));
  }, [draft]);

  const recoverableDraft = useMemo(() => {
    if (!storageKey || typeof window === "undefined") {
      return null;
    }
    void recoveryRefreshCount;

    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored) as DraftPayload;
      const normalized = JSON.stringify(toPayload(toState(parsed)));

      if (normalized === initialSerializedDraft) {
        window.localStorage.removeItem(storageKey);
        return null;
      }
      return parsed;
    } catch {
      window.localStorage.removeItem(storageKey);
      return null;
    }
  }, [initialSerializedDraft, recoveryRefreshCount, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    if (serializedDraft === initialSerializedDraft) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, serializedDraft);
  }, [initialSerializedDraft, serializedDraft, storageKey]);

  const draftByteSize = useMemo(() => {
    return new TextEncoder().encode(serializedDraft).length;
  }, [serializedDraft]);

  const canEdit = Boolean(
    blueprint &&
    ((blueprint.status === "draft" && isTeacher) || (blueprint.status !== "draft" && isOwner)),
  );
  const canApprove = Boolean(blueprint && isOwner && blueprint.status === "draft");
  const canViewOverview = Boolean(
    blueprint && isOwner && (blueprint.status === "approved" || blueprint.status === "published"),
  );

  const warningMessage =
    blueprint && blueprint.status !== "draft"
      ? "Saving will create a new draft version and archive the current blueprint."
      : null;

  const handleSummaryChange = (value: string) => {
    dispatch({
      type: "set",
      next: { ...draft, summary: value },
    });
  };

  const handleTopicUpdate = (topicId: string, update: Partial<DraftTopicState>) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) =>
          topic.clientId === topicId ? { ...topic, ...update } : topic,
        ),
      },
    });
  };

  const handleObjectiveUpdate = (
    topicId: string,
    objectiveId: string,
    update: Partial<DraftObjectiveState>,
  ) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) => {
          if (topic.clientId !== topicId) {
            return topic;
          }
          return {
            ...topic,
            objectives: topic.objectives.map((objective) =>
              objective.clientId === objectiveId ? { ...objective, ...update } : objective,
            ),
          };
        }),
      },
    });
  };

  const updatePrerequisites = (topicId: string, updater: (current: string[]) => string[]) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) =>
          topic.clientId === topicId
            ? {
                ...topic,
                prerequisiteClientIds: updater(topic.prerequisiteClientIds ?? []),
              }
            : topic,
        ),
      },
    });
  };

  const handleAddPrerequisite = (topicId: string, prerequisiteId: string) => {
    updatePrerequisites(topicId, (current) =>
      current.includes(prerequisiteId) ? current : [...current, prerequisiteId],
    );
  };

  const handleRemovePrerequisite = (topicId: string, prerequisiteId: string) => {
    updatePrerequisites(topicId, (current) => current.filter((id) => id !== prerequisiteId));
  };

  const handleMovePrerequisite = (topicId: string, prerequisiteId: string, direction: -1 | 1) => {
    updatePrerequisites(topicId, (current) => {
      const index = current.indexOf(prerequisiteId);
      if (index === -1) {
        return current;
      }
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const updated = [...current];
      const [item] = updated.splice(index, 1);
      updated.splice(nextIndex, 0, item);
      return updated;
    });
  };

  const handleAddObjective = (topicId: string) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) => {
          if (topic.clientId !== topicId) {
            return topic;
          }
          return {
            ...topic,
            objectives: [
              ...topic.objectives,
              {
                statement: "",
                level: "",
                clientId: makeClientId(),
              },
            ],
          };
        }),
      },
    });
  };

  const handleRemoveObjective = (topicId: string, objectiveId: string) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) => {
          if (topic.clientId !== topicId) {
            return topic;
          }
          return {
            ...topic,
            objectives: topic.objectives.filter((objective) => objective.clientId !== objectiveId),
          };
        }),
      },
    });
  };

  const handleAddTopic = () => {
    const nextSequence =
      draft.topics.length === 0 ? 1 : Math.max(...draft.topics.map((topic) => topic.sequence)) + 1;

    const newTopic: DraftTopicState = {
      clientId: makeClientId(),
      title: "",
      description: "",
      section: "",
      sequence: nextSequence,
      prerequisiteClientIds: [],
      objectives: [
        {
          statement: "",
          level: "",
          clientId: makeClientId(),
        },
      ],
    };

    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: [...draft.topics, newTopic],
      },
    });
  };

  const handleRemoveTopic = (topicId: string) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics
          .filter((topic) => topic.clientId !== topicId)
          .map((topic) => ({
            ...topic,
            prerequisiteClientIds:
              topic.prerequisiteClientIds?.filter((id) => id !== topicId) ?? [],
          })),
      },
    });
  };

  const handleReset = () => {
    dispatch({ type: "reset", next: initialState });
    setIsEditing(false);
  };

  const handleRestoreLocalDraft = () => {
    if (!recoverableDraft) {
      return;
    }
    dispatch({ type: "reset", next: toState(recoverableDraft) });
    if (storageKey) {
      window.localStorage.removeItem(storageKey);
    }
    setIsEditing(true);
    setRecoveryRefreshCount((count) => count + 1);
  };

  const handleDismissLocalDraft = () => {
    if (storageKey) {
      window.localStorage.removeItem(storageKey);
    }
    setRecoveryRefreshCount((count) => count + 1);
  };

  if (!blueprint || !initialDraft) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-400">
        No blueprint yet. Generate one to start editing.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Version {blueprint.version}
          </p>
          <p className="text-sm text-slate-300">Status: {blueprint.status}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canViewOverview ? (
            <Link
              href={`/classes/${classId}/blueprint/overview`}
              className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
            >
              View overview
            </Link>
          ) : null}
          {blueprint?.status === "published" && isOwner && !isEditing ? (
            <form action={createDraftFromPublished.bind(null, classId)}>
              <StartDraftButton />
            </form>
          ) : null}
          {canApprove && !isEditing ? (
            <form action={approveBlueprint.bind(null, classId, blueprint.id)}>
              <ApproveBlueprintButton />
            </form>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30"
            >
              {isEditing ? "Close editor" : "Edit draft"}
            </button>
          ) : null}
        </div>
      </div>

      {warningMessage ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
          {warningMessage}
        </div>
      ) : null}

      {recoverableDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-xs text-cyan-100">
          <p>Unsaved local changes were found for this blueprint.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreLocalDraft}
              className="rounded-full bg-cyan-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-950"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={handleDismissLocalDraft}
              className="rounded-full border border-cyan-200/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-cyan-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {isEditing ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
          <form action={saveDraft.bind(null, classId, blueprint.id)} className="space-y-6">
            <input type="hidden" name="draft" value={serializedDraft} />

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <label className="text-sm font-semibold" htmlFor="summary">
                Blueprint summary
              </label>
              <textarea
                id="summary"
                value={draft.summary}
                onChange={(event) => handleSummaryChange(event.target.value)}
                rows={4}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              />
            </div>

            <div className="space-y-4">
              {draft.topics.map((topic, index) => {
                const selectedPrereqs = topic.prerequisiteClientIds ?? [];
                const availablePrereqs = draft.topics.filter(
                  (option) =>
                    option.clientId !== topic.clientId &&
                    !selectedPrereqs.includes(option.clientId),
                );

                return (
                  <div
                    key={topic.clientId}
                    className="rounded-3xl border border-white/10 bg-slate-900/70 p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold">Topic {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => handleRemoveTopic(topic.clientId)}
                        disabled={draft.topics.length <= 1}
                        className="text-xs uppercase tracking-[0.2em] text-rose-200 disabled:opacity-40"
                      >
                        Remove topic
                      </button>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div className="md:col-span-2">
                        <label
                          className="text-xs uppercase tracking-[0.2em] text-slate-400"
                          htmlFor={`topic-${topic.clientId}-title`}
                        >
                          Title
                        </label>
                        <input
                          id={`topic-${topic.clientId}-title`}
                          value={topic.title}
                          onChange={(event) =>
                            handleTopicUpdate(topic.clientId, {
                              title: event.target.value,
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                        />
                      </div>
                      <div>
                        <label
                          className="text-xs uppercase tracking-[0.2em] text-slate-400"
                          htmlFor={`topic-${topic.clientId}-sequence`}
                        >
                          Sequence
                        </label>
                        <input
                          id={`topic-${topic.clientId}-sequence`}
                          type="number"
                          min={1}
                          max={1000}
                          step={1}
                          value={topic.sequence}
                          onChange={(event) =>
                            handleTopicUpdate(topic.clientId, {
                              sequence: Number(event.target.value),
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label
                        className="text-xs uppercase tracking-[0.2em] text-slate-400"
                        htmlFor={`topic-${topic.clientId}-description`}
                      >
                        Description
                      </label>
                      <textarea
                        id={`topic-${topic.clientId}-description`}
                        value={topic.description ?? ""}
                        onChange={(event) =>
                          handleTopicUpdate(topic.clientId, {
                            description: event.target.value,
                          })
                        }
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                      />
                    </div>
                    <div className="mt-4">
                      <label
                        className="text-xs uppercase tracking-[0.2em] text-slate-400"
                        htmlFor={`topic-${topic.clientId}-section`}
                      >
                        Section
                      </label>
                      <input
                        id={`topic-${topic.clientId}-section`}
                        value={topic.section ?? ""}
                        onChange={(event) =>
                          handleTopicUpdate(topic.clientId, {
                            section: event.target.value,
                          })
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Prerequisites
                      </label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedPrereqs.length > 0 ? (
                          selectedPrereqs.map((prereqId, prereqIndex) => (
                            <div
                              key={`${topic.clientId}-prereq-${prereqId}`}
                              className="flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-xs text-slate-200"
                            >
                              <span>{topicTitleById.get(prereqId) ?? "Untitled"}</span>
                              <button
                                type="button"
                                onClick={() => handleMovePrerequisite(topic.clientId, prereqId, -1)}
                                disabled={prereqIndex === 0}
                                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] disabled:opacity-40"
                              >
                                Up
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMovePrerequisite(topic.clientId, prereqId, 1)}
                                disabled={prereqIndex === selectedPrereqs.length - 1}
                                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] disabled:opacity-40"
                              >
                                Down
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemovePrerequisite(topic.clientId, prereqId)}
                                className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-rose-200"
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-slate-500">No prerequisites selected yet.</p>
                        )}
                      </div>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!value) {
                            return;
                          }
                          handleAddPrerequisite(topic.clientId, value);
                          event.currentTarget.value = "";
                        }}
                        className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                      >
                        <option value="">Add prerequisite</option>
                        {availablePrereqs.map((option) => (
                          <option key={option.clientId} value={option.clientId}>
                            {option.title || "Untitled topic"}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Objectives
                        </p>
                        <button
                          type="button"
                          onClick={() => handleAddObjective(topic.clientId)}
                          className="text-xs uppercase tracking-[0.2em] text-cyan-200"
                        >
                          Add objective
                        </button>
                      </div>
                      {topic.objectives.map((objective) => (
                        <div
                          key={objective.clientId}
                          className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Objective
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveObjective(topic.clientId, objective.clientId)
                              }
                              disabled={topic.objectives.length <= 1}
                              className="text-xs uppercase tracking-[0.2em] text-rose-200 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                          <label
                            className="mt-3 block text-xs uppercase tracking-[0.2em] text-slate-400"
                            htmlFor={`objective-${objective.clientId}-statement`}
                          >
                            Statement
                          </label>
                          <textarea
                            id={`objective-${objective.clientId}-statement`}
                            value={objective.statement}
                            onChange={(event) =>
                              handleObjectiveUpdate(topic.clientId, objective.clientId, {
                                statement: event.target.value,
                              })
                            }
                            rows={2}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                          />
                          <div className="mt-3">
                            <label
                              className="text-xs uppercase tracking-[0.2em] text-slate-400"
                              htmlFor={`objective-${objective.clientId}-level`}
                            >
                              Bloom level
                            </label>
                            <select
                              id={`objective-${objective.clientId}-level`}
                              value={objective.level ?? ""}
                              onChange={(event) =>
                                handleObjectiveUpdate(topic.clientId, objective.clientId, {
                                  level: event.target.value,
                                })
                              }
                              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                            >
                              <option value="">Select level</option>
                              {BLOOM_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                  {level}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddTopic}
              className="w-full rounded-2xl border border-dashed border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100"
            >
              Add topic
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "undo" })}
                  disabled={!canUndo}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "redo" })}
                  disabled={!canRedo}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 disabled:opacity-40"
                >
                  Redo
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!hasChanges}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 disabled:opacity-40"
                >
                  Discard changes
                </button>
              </div>
              <div className="flex flex-col items-end gap-2">
                {draftByteSize > MAX_DRAFT_BYTES ? (
                  <p className="text-xs text-amber-200">
                    Draft size is {Math.round(draftByteSize / 1024)}KB. Saving might fail for very
                    large drafts.
                  </p>
                ) : null}
                <SaveDraftButton />
              </div>
            </div>
          </form>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">Topic map</h2>
              <p className="mt-2 text-sm text-slate-400">
                A quick dependency view based on sequences and prerequisites.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              {draft.topics.length === 0 ? (
                <p className="text-sm text-slate-400">Add topics to see the map.</p>
              ) : topicMap.errorMessage ? (
                <div className="space-y-2 text-sm text-amber-200">
                  <p>{topicMap.errorMessage}</p>
                  <p className="text-xs text-amber-100">{dependencySummary}</p>
                </div>
              ) : topicMap.hasCycle ? (
                <div className="space-y-3 text-sm text-amber-200">
                  <p>Cycle detected in prerequisites. Fix the loop to view the map.</p>
                  <ul className="list-disc pl-5 text-xs text-amber-100">
                    {draft.topics.map((topic) => (
                      <li key={`cycle-${topic.clientId}`}>
                        {topic.title || "Untitled"} →
                        {topic.prerequisiteClientIds?.length
                          ? ` ${topic.prerequisiteClientIds
                              .map((id) => topicTitleById.get(id) ?? "Untitled")
                              .join(", ")}`
                          : " none"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                (() => {
                  const padding = 20;
                  const mapWidth = Math.max(topicMap.width + padding * 2, 240);
                  const mapHeight = Math.max(topicMap.height + padding * 2, 240);

                  return (
                    <>
                      <svg
                        className="w-full"
                        viewBox={`0 0 ${mapWidth} ${mapHeight}`}
                        role="img"
                        aria-label="Topic dependency map"
                        aria-describedby="topic-map-desc"
                      >
                        <title>Topic dependency map</title>
                        <desc id="topic-map-desc">{dependencySummary}</desc>
                        <rect
                          x={0}
                          y={0}
                          width={mapWidth}
                          height={mapHeight}
                          rx={24}
                          fill="#0f172a"
                        />
                        {topicMap.edges.map((edge) => {
                          const from = nodeById.get(edge.from);
                          const to = nodeById.get(edge.to);
                          if (!from || !to) {
                            return null;
                          }
                          const startX = from.x + MAP_NODE_WIDTH + padding;
                          const startY = from.y + MAP_NODE_HEIGHT / 2 + padding;
                          const endX = to.x + padding;
                          const endY = to.y + MAP_NODE_HEIGHT / 2 + padding;
                          return (
                            <line
                              key={`${edge.from}-${edge.to}`}
                              x1={startX}
                              y1={startY}
                              x2={endX}
                              y2={endY}
                              stroke="#38bdf8"
                              strokeWidth={2}
                              opacity={0.6}
                            />
                          );
                        })}
                        {topicMap.nodes.map((node) => {
                          const label =
                            node.title.length > 18 ? `${node.title.slice(0, 18)}...` : node.title;
                          return (
                            <g key={node.id}>
                              <rect
                                x={node.x + padding}
                                y={node.y + padding}
                                width={MAP_NODE_WIDTH}
                                height={MAP_NODE_HEIGHT}
                                rx={16}
                                fill="#1e293b"
                                stroke="#334155"
                              />
                              <text
                                x={node.x + padding + MAP_NODE_WIDTH / 2}
                                y={node.y + padding + MAP_NODE_HEIGHT / 2 + 4}
                                textAnchor="middle"
                                fill="#e2e8f0"
                                fontSize="12"
                                fontFamily="sans-serif"
                              >
                                {label}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <div className="sr-only">{dependencySummary}</div>
                    </>
                  );
                })()
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Blueprint summary</h2>
            <p className="mt-2 text-sm text-slate-400">{draft.summary}</p>
          </div>
          <div className="space-y-4">
            {draft.topics.map((topic) => (
              <div
                key={topic.clientId}
                className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">{topic.title}</h3>
                    {topic.section ? (
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                        Section: {topic.section}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                    Sequence {topic.sequence}
                  </span>
                </div>
                {topic.description ? (
                  <p className="mt-2 text-sm text-slate-400">{topic.description}</p>
                ) : null}
                {topic.prerequisiteClientIds?.length ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Prerequisites:{" "}
                    {topic.prerequisiteClientIds
                      .map((id) => topicTitleById.get(id) ?? "Untitled")
                      .join(", ")}
                  </p>
                ) : null}
                <ul className="mt-3 space-y-1 text-sm text-slate-400">
                  {topic.objectives.map((objective) => (
                    <li key={objective.clientId}>
                      - {objective.statement}
                      {objective.level ? ` (${objective.level})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
