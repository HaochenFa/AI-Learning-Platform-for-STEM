"use client";

import Link from "next/link";
import { useMemo, useReducer, useState } from "react";
import { useFormStatus } from "react-dom";
import { approveBlueprint, saveDraft } from "@/app/classes/[classId]/blueprint/actions";

const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

const MAX_HISTORY_ENTRIES = 50;
const MAX_DRAFT_BYTES = 1_000_000;

type DraftObjective = {
  id?: string;
  statement: string;
  level?: string | null;
};

type DraftTopic = {
  id?: string;
  title: string;
  description?: string | null;
  sequence: number;
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
  clientId: string;
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
      clientId: topic.id ?? makeClientId(),
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
      title: topic.title,
      description: topic.description?.trim() ? topic.description : null,
      sequence: topic.sequence,
      objectives: topic.objectives.map((objective) => ({
        id: objective.id,
        statement: objective.statement,
        level: objective.level?.trim() ? objective.level : null,
      })),
    })),
  };
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

  const initialState = useMemo(() => {
    if (!initialDraft) {
      return { summary: "", topics: [] };
    }
    return toState(initialDraft);
  }, [initialDraft]);

  const [history, dispatch] = useReducer(historyReducer, {
    history: [initialState],
    cursor: 0,
  });

  const draft = history.history[history.cursor];
  const canUndo = history.cursor > 0;
  const canRedo = history.cursor < history.history.length - 1;
  const hasChanges = history.cursor > 0;

  const serializedDraft = useMemo(() => {
    return JSON.stringify(toPayload(draft));
  }, [draft]);

  const draftByteSize = useMemo(() => {
    return new TextEncoder().encode(serializedDraft).length;
  }, [serializedDraft]);

  const canEdit = Boolean(blueprint && isTeacher);
  const canApprove = Boolean(blueprint && isOwner && blueprint.status === "draft");
  const canViewOverview = Boolean(
    blueprint &&
      isOwner &&
      (blueprint.status === "approved" || blueprint.status === "published")
  );

  const warningMessage =
    blueprint && blueprint.status !== "draft"
      ? "Saving will return this blueprint to draft and clear approval/publish status."
      : null;

  const handleSummaryChange = (value: string) => {
    dispatch({
      type: "set",
      next: { ...draft, summary: value },
    });
  };

  const handleTopicUpdate = (
    topicId: string,
    update: Partial<DraftTopicState>
  ) => {
    dispatch({
      type: "set",
      next: {
        ...draft,
        topics: draft.topics.map((topic) =>
          topic.clientId === topicId ? { ...topic, ...update } : topic
        ),
      },
    });
  };

  const handleObjectiveUpdate = (
    topicId: string,
    objectiveId: string,
    update: Partial<DraftObjectiveState>
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
              objective.clientId === objectiveId
                ? { ...objective, ...update }
                : objective
            ),
          };
        }),
      },
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
            objectives: topic.objectives.filter(
              (objective) => objective.clientId !== objectiveId
            ),
          };
        }),
      },
    });
  };

  const handleAddTopic = () => {
    const nextSequence =
      draft.topics.length === 0
        ? 1
        : Math.max(...draft.topics.map((topic) => topic.sequence)) + 1;

    const newTopic: DraftTopicState = {
      title: "",
      description: "",
      sequence: nextSequence,
      objectives: [
        {
          statement: "",
          level: "",
          clientId: makeClientId(),
        },
      ],
      clientId: makeClientId(),
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
        topics: draft.topics.filter((topic) => topic.clientId !== topicId),
      },
    });
  };

  const handleReset = () => {
    dispatch({ type: "reset", next: initialState });
    setIsEditing(false);
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
          {canApprove && !isEditing ? (
            <form action={approveBlueprint.bind(null, classId, blueprint.id)}>
              <button
                type="submit"
                className="rounded-full bg-cyan-400/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950"
              >
                Approve & view
              </button>
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

      {isEditing ? (
        <form
          action={saveDraft.bind(null, classId, blueprint.id)}
          className="space-y-6"
        >
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
            {draft.topics.map((topic, index) => (
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
                            handleRemoveObjective(
                              topic.clientId,
                              objective.clientId
                            )
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
                          handleObjectiveUpdate(
                            topic.clientId,
                            objective.clientId,
                            { statement: event.target.value }
                          )
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
                            handleObjectiveUpdate(
                              topic.clientId,
                              objective.clientId,
                              { level: event.target.value }
                            )
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
            ))}
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
                  Draft size is {Math.round(draftByteSize / 1024)}KB. Saving might
                  fail for very large drafts.
                </p>
              ) : null}
              <SaveDraftButton />
            </div>
          </div>
        </form>
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
                  <h3 className="text-base font-semibold">{topic.title}</h3>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                    Sequence {topic.sequence}
                  </span>
                </div>
                {topic.description ? (
                  <p className="mt-2 text-sm text-slate-400">
                    {topic.description}
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
