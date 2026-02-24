"use client";

import { useMemo, useState, useTransition } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { sendAssignmentMessage, submitChatAssignment } from "@/app/classes/[classId]/chat/actions";
import type { ChatTurn } from "@/lib/chat/types";
import { MAX_CHAT_MESSAGE_CHARS, MAX_REFLECTION_CHARS } from "@/lib/chat/validation";

type AssignmentChatPanelProps = {
  classId: string;
  assignmentId: string;
  instructions: string;
  initialTranscript: ChatTurn[];
  initialReflection: string;
  isSubmitted: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AssignmentChatPanel({
  classId,
  assignmentId,
  instructions,
  initialTranscript,
  initialReflection,
  isSubmitted,
}: AssignmentChatPanelProps) {
  const [transcript, setTranscript] = useState<ChatTurn[]>(initialTranscript);
  const [reflection, setReflection] = useState(initialReflection);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const serializedTranscript = useMemo(() => JSON.stringify(transcript), [transcript]);

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitted) {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const studentTurn: ChatTurn = {
      role: "student",
      message: trimmed,
      createdAt: new Date().toISOString(),
    };

    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      formData.set("message", trimmed);
      formData.set("transcript", JSON.stringify([...transcript, studentTurn]));

      const result = await sendAssignmentMessage(classId, assignmentId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const assistantTurn: ChatTurn = {
        role: "assistant",
        message: result.response.answer,
        createdAt: new Date().toISOString(),
        citations: result.response.citations.map((citation) => ({
          sourceLabel: citation.sourceLabel,
          snippet: citation.rationale,
        })),
      };

      setTranscript((current) => [...current, studentTurn, assistantTurn]);
      setMessage("");
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-700">
        <p className="font-medium">Assignment Instructions</p>
        <p className="mt-1">{instructions}</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="max-h-104 space-y-3 overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50 p-4">
        {transcript.length === 0 ? (
          <p className="text-sm text-slate-500">Start by asking your first assignment question.</p>
        ) : (
          transcript.map((turn, index) => (
            <div
              key={`${turn.role}-${turn.createdAt}-${index}`}
              className={`rounded-2xl border p-4 ${
                turn.role === "student"
                  ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-700"
                  : "border-slate-200 bg-white text-slate-900"
              }`}
            >
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                <span>{turn.role === "student" ? "You" : "AI Tutor"}</span>
                <span className="text-slate-500">{formatDate(turn.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{turn.message}</p>
              {turn.citations && turn.citations.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {turn.citations.map((citation) => (
                    <li key={`${citation.sourceLabel}-${citation.snippet ?? ""}`}>
                      {citation.sourceLabel}
                      {citation.snippet ? `: ${citation.snippet}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </div>

      <form className="space-y-3" onSubmit={handleSend}>
        <label className="text-sm text-slate-600" htmlFor="assignment-chat-message">
          Message
        </label>
        <textarea
          id="assignment-chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          rows={4}
          disabled={isSubmitted}
          placeholder="Continue the assignment conversation..."
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {message.length}/{MAX_CHAT_MESSAGE_CHARS}
          </p>
          <button
            type="submit"
            disabled={isPending || isSubmitted || !message.trim()}
            className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-400/40"
          >
            {isPending ? "Thinking..." : "Send"}
          </button>
        </div>
      </form>

      <form action={submitChatAssignment.bind(null, classId, assignmentId)} className="space-y-3">
        <input type="hidden" name="transcript" value={serializedTranscript} readOnly />
        <div className="space-y-2">
          <label className="text-sm text-slate-600" htmlFor="assignment-reflection">
            Reflection
          </label>
          <textarea
            id="assignment-reflection"
            name="reflection"
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            maxLength={MAX_REFLECTION_CHARS}
            rows={4}
            disabled={isSubmitted}
            placeholder="What did you learn from this chat?"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p className="text-xs text-slate-500">
            {reflection.length}/{MAX_REFLECTION_CHARS}
          </p>
        </div>
        <PendingSubmitButton
          label={isSubmitted ? "Submitted" : "Submit Assignment"}
          pendingLabel="Submitting..."
          disabled={isSubmitted}
          className="rounded-xl bg-emerald-400/90 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/40"
        />
      </form>
    </div>
  );
}
